import type { CaptureStatus, FrameStat, Sample, SampleBatch } from './capture';
import { DSP_CONFIG } from './config';
import { frameProblem, validChannels } from './contact';
import { butterBandpass, CausalFilter, type SosSection } from './filters';
import type { CoachingKey, LiveSession, RejectedSpan, SqiWindow } from './live-session';
import { FlatRuns, modelWindowAt, nextModelTickS, unscoredSpan, usableFrom } from './model-window';
import type { NsSpan, SqiScores } from './reading';
import { cleanSeconds as cleanTime, frameGapSpan } from './reading-metrics';

export interface LiveSessionConfig {
  captureFps: number; // the capture format's frame rate; sizes the buffers and designs the live filter
  sqiThreshold: number; // SQI-Net P(clean) threshold from the model manifest (§11.2)
  perfusionFloorPct: number; // device-database floor (§7), or live.defaultPerfusionFloorPct
}

// Highest priority first: no contact makes every other message moot; pressure and leaks are about the
// finger; motion and cold hands need a covered lens to mean anything.
const PRIORITY: CoachingKey[] = ['coach.cover', 'coach.lighter', 'coach.flat', 'coach.still', 'coach.warm'];

// One coaching key at a time with enter, minimum-show, and exit dwell times (live block, ADR 0042).
class CoachingMachine {
  private readonly trueSince = new Map<CoachingKey, number>();
  private readonly falseSince = new Map<CoachingKey, number>();
  private shown: CoachingKey | null = null;
  private shownAt = 0;

  get key(): CoachingKey | null {
    return this.shown;
  }

  update(tS: number, active: Set<CoachingKey>): void {
    for (const key of PRIORITY) {
      if (active.has(key)) {
        if (!this.trueSince.has(key)) this.trueSince.set(key, tS);
        this.falseSince.delete(key);
      } else {
        if (!this.falseSince.has(key)) this.falseSince.set(key, tS);
        this.trueSince.delete(key);
      }
    }
    const { coachEnterS, coachMinShowS, coachExitS } = DSP_CONFIG.live;
    const top = PRIORITY.find((key) => {
      const since = this.trueSince.get(key);
      return since !== undefined && tS - since >= coachEnterS;
    });
    const show = (key: CoachingKey | null) => {
      if (key !== this.shown) this.shownAt = tS;
      this.shown = key;
    };
    if (this.shown === null) {
      if (top) show(top);
      return;
    }
    // A more urgent message replaces the shown one at once; otherwise a shown key stays its minimum time.
    if (top && PRIORITY.indexOf(top) < PRIORITY.indexOf(this.shown)) return show(top);
    if (tS - this.shownAt < coachMinShowS) return;
    if (top) return show(top);
    const goneSince = this.falseSince.get(this.shown);
    if (goneSince !== undefined && tS - goneSince >= coachExitS) show(null);
  }
}

// A span that grows with the capture; endS is set when it closes.
interface OpenSpan {
  startS: number;
  reason: RejectedSpan['reason'];
}

class Session implements LiveSession {
  private readonly config: LiveSessionConfig;
  private readonly sos: SosSection[];
  private readonly capacity: number;
  // Ring buffers sized for the longest reading (live.maxReadingS), so they never wrap within one.
  private readonly tS: Float64Array;
  private readonly red: Float64Array;
  private readonly filtered: Float64Array;
  private readonly covered: Uint8Array;
  // The frames as received, for readingInput (H-025).
  private readonly samples: Sample[] = [];
  private readonly stats: FrameStat[] = [];
  private count = 0;
  private startNs: number | null = null;
  private lastNs = -Infinity;
  private lastExposureNs: number | null = null;
  private filter: CausalFilter | null = null;

  private readonly closed: RejectedSpan[] = []; // contact (DSP-4)
  private readonly exposure: RejectedSpan[] = []; // DSP-5
  // Motion and cold hands are kept on the capture clock, as analyzeReading takes them (H-025); both edges
  // fall on frame times, so no rounding is involved.
  private readonly motion: NsSpan[] = [];
  private readonly coldHands: NsSpan[] = [];
  private readonly quality: RejectedSpan[] = [];
  private readonly flatRuns = new FlatRuns();
  // Checks with no window (ADR 0057); rejected only once SQI-Net has run, as analyzeReading does with sqi.
  private readonly unscored: RejectedSpan[] = [];
  private formedEndS: number | null = null; // end of the newest window, sent to SQI-Net or rejected
  private readonly gaps: RejectedSpan[] = []; // DSP-2 frame gaps: not clean (ADR 0072)
  private openContact: OpenSpan | null = null;
  private openMotionNs: number | null = null;
  private openColdHandsNs: number | null = null;
  // Every setSqi score; endS on the 64 Hz grid. Flat and sparse windows are not here: analyzeReading finds
  // them in the frames, as tick does.
  private readonly scores: { endS: number; pClean: number }[] = [];
  private modelRan = false;

  private leaking = false;
  private nextTickS: number;
  private latestWindow: SqiWindow | null = null;
  private readonly coaching = new CoachingMachine();
  // Highest true clean seconds so far, at the end of each batch: the displayed count (ADR 0042).
  private shownClean = 0;
  private livePerfusionPct: number | null = null; // set each tick; null without a usable window

  constructor(config: LiveSessionConfig) {
    const { morphologyOrder, morphologyBandHz } = DSP_CONFIG.dsp6;
    const [lowHz, highHz] = morphologyBandHz as [number, number];
    if (!(config.captureFps > 2 * highHz))
      throw new RangeError(
        `the ${highHz} Hz live band needs more than ${2 * highHz} fps, got ${config.captureFps}`,
      );
    const { maxReadingS, frameMargin, sqiEveryS } = DSP_CONFIG.live;
    this.config = config;
    this.sos = butterBandpass(morphologyOrder, lowHz, highHz, config.captureFps);
    this.capacity = Math.ceil(maxReadingS * config.captureFps * (1 + frameMargin));
    this.tS = new Float64Array(this.capacity);
    this.red = new Float64Array(this.capacity);
    this.filtered = new Float64Array(this.capacity);
    this.covered = new Uint8Array(this.capacity);
    this.nextTickS = sqiEveryS;
  }

  private get latestS(): number {
    return this.count > 0 ? this.tS[this.count - 1]! : 0;
  }

  pushSamples(batch: SampleBatch): void {
    const { samples, stats } = batch;
    if (samples.length !== stats.length)
      throw new RangeError(`${samples.length} samples but ${stats.length} frame stats`);
    if (this.count + samples.length > this.capacity)
      throw new RangeError(`the reading exceeds ${this.capacity} frames (${DSP_CONFIG.live.maxReadingS} s)`);
    let previousNs = this.lastNs;
    samples.forEach((sample, i) => {
      if (stats[i]!.tNs !== sample.tNs)
        throw new RangeError(`frame ${i}: sample at ${sample.tNs} ns but stats at ${stats[i]!.tNs} ns`);
      if (!Number.isFinite(sample.tNs) || sample.tNs <= previousNs)
        throw new RangeError(`timestamps must strictly increase; ${sample.tNs} ns does not`);
      previousNs = sample.tNs;
    });
    // Everything addFrame could refuse is checked above, and DSP-4 keeps non-finite values out of every
    // spline, so a batch is applied whole or not at all.
    samples.forEach((sample, i) => this.addFrame(sample, stats[i]!));
    this.shownClean = Math.max(this.shownClean, this.trueCleanSeconds());
  }

  private addFrame(sample: SampleBatch['samples'][number], stat: SampleBatch['stats'][number]): void {
    this.startNs ??= sample.tNs;
    // DSP-1: seconds from the first frame, subtracted in ns first.
    const tS = (sample.tNs - this.startNs) / 1e9;
    const gapSpan = this.count > 0 ? frameGapSpan(this.latestS, tS) : null;
    if (gapSpan) this.gaps.push(gapSpan);
    // The causal filter assumes evenly spaced frames; after a DSP-2 gap it restarts in steady state.
    if (this.filter === null || gapSpan) this.filter = new CausalFilter(this.sos);
    // A broken frame (NaN, or a channel outside 0..1) would leave the filter state NaN or ringing. It is a
    // coverage frame (DSP-4), so the waveform holds its last value and the filter restarts after it.
    const valid = validChannels(sample);
    const value = valid
      ? this.filter.filter([-sample.r])[0]!
      : this.count > 0
        ? this.filtered[this.count - 1]!
        : 0;
    if (!valid) this.filter = null;

    if (this.lastExposureNs !== null && stat.exposureNs !== this.lastExposureNs) {
      const holdS = DSP_CONFIG.dsp5.exposureChangeArtifactS;
      this.exposure.push({ startS: tS, endS: tS + holdS, reason: 'exposure' });
    }
    this.lastExposureNs = stat.exposureNs;

    const problem = frameProblem(sample, stat);
    if (this.openContact && this.openContact.reason !== problem) {
      this.closed.push({ ...this.openContact, endS: tS });
      this.openContact = null;
    }
    if (problem && !this.openContact) this.openContact = { startS: tS, reason: problem };
    this.leaking = problem === null && sample.r < DSP_CONFIG.live.leakRedRatio * (sample.g + sample.b);

    this.samples.push({ ...sample });
    this.stats.push({ ...stat });
    const at = this.count++;
    this.tS[at] = tS;
    this.red[at] = sample.r;
    this.filtered[at] = value;
    this.covered[at] = problem === 'coverage' ? 0 : 1;
    this.flatRuns.add(tS, sample.r, problem !== 'coverage');
    this.lastNs = sample.tNs;

    if (tS >= this.nextTickS) {
      this.tick(tS);
      this.nextTickS = nextModelTickS(tS);
    }
    this.updateCoaching();
  }

  pushStatus(status: CaptureStatus): void {
    // Statuses carry no timestamp; each applies at the newest frame.
    if (this.count === 0) return;
    // A non-finite reading is not evidence of stillness, so it counts as moving.
    const { motionRms } = status;
    const moving = !Number.isFinite(motionRms) || motionRms > DSP_CONFIG.live.motionRmsThreshold;
    if (moving && this.openMotionNs === null) this.openMotionNs = this.lastNs;
    if (!moving && this.openMotionNs !== null) {
      this.motion.push({ startNs: this.openMotionNs, endNs: this.lastNs });
      this.openMotionNs = null;
    }
    this.updateCoaching();
  }

  setSqi(windowEndS: number, pClean: number): void {
    // A window ends inside the reading; outside it, start + end can pass 2^53 ns and round.
    if (!(this.count > 0 && windowEndS >= 0 && windowEndS <= this.latestS))
      throw new RangeError(`window end ${windowEndS} s is outside the reading (0 to ${this.latestS} s)`);
    // readingInput hands the end on in whole ns; a finer end would come back as a different span.
    if (Math.round(windowEndS * 1e9) / 1e9 !== windowEndS)
      throw new RangeError(`window end ${windowEndS} s is not a whole ns; pass sqiWindow.endS unchanged`);
    if (!(pClean >= 0 && pClean <= 1)) throw new RangeError(`P(clean) must be in [0, 1], got ${pClean}`);
    this.modelRan = true;
    // Advisory (owner 2026-10-06, superseding H-024's reject-only guard): a low score is kept for the reading's
    // sqiFlagged tag (above dsp3.sqiFlaggedMaxShare) and never stops the clean count.
    this.scores.push({ endS: windowEndS, pClean });
  }

  // A window SQI-Net cannot score (flat or not finite, ADR 0023): the rule checks reject it.
  private rejectWindow(windowEndS: number): void {
    const windowS = DSP_CONFIG.dsp3.modelWindowS;
    this.quality.push({ startS: windowEndS - windowS, endS: windowEndS, reason: 'quality' });
  }

  // Once per sqiEveryS: the SQI-Net window (§11.2, ADR 0023) and the cold-hands check (§7).
  private tick(tS: number): void {
    const window = modelWindowAt(this.tS, this.red, this.covered, this.count);
    this.latestWindow = window?.input ? { endS: window.endS, input: window.input } : null;
    if (window && !window.input) this.rejectWindow(window.endS);
    const unscored = window ? null : unscoredSpan(this.tS, this.count, this.formedEndS);
    if (unscored) this.unscored.push(unscored);
    if (window) this.formedEndS = window.endS;

    const { coldHandsAfterS, perfusionWindowS } = DSP_CONFIG.live;
    const from = usableFrom(this.tS, this.covered, this.count, tS - perfusionWindowS);
    this.livePerfusionPct = null;
    if (from !== null) {
      let low = Infinity;
      let high = -Infinity;
      let total = 0;
      for (let i = from; i < this.count; i++) {
        low = Math.min(low, this.filtered[i]!);
        high = Math.max(high, this.filtered[i]!);
        total += this.red[i]!;
      }
      this.livePerfusionPct = (100 * (high - low)) / (total / (this.count - from));
    }
    // §7: cold hands only after coldHandsAfterS.
    const cold =
      tS >= coldHandsAfterS &&
      this.livePerfusionPct !== null &&
      this.livePerfusionPct < this.config.perfusionFloorPct;
    // tick runs on the newest frame, so lastNs is the frame at tS.
    if (cold && this.openColdHandsNs === null) this.openColdHandsNs = this.lastNs;
    if (!cold && this.openColdHandsNs !== null) {
      this.coldHands.push({ startNs: this.openColdHandsNs, endNs: this.lastNs });
      this.openColdHandsNs = null;
    }
  }

  private updateCoaching(): void {
    const active = new Set<CoachingKey>();
    if (this.openContact?.reason === 'coverage') active.add('coach.cover');
    if (this.openContact?.reason === 'clipping') active.add('coach.lighter');
    if (this.leaking) active.add('coach.flat');
    if (this.openMotionNs !== null) active.add('coach.still');
    if (this.openColdHandsNs !== null) active.add('coach.warm');
    this.coaching.update(this.latestS, active);
  }

  // Closed spans, then the open one ending at the newest frame.
  private nsSpans(closed: NsSpan[], openNs: number | null): NsSpan[] {
    const spans = closed.map((span) => ({ ...span }));
    if (openNs !== null) spans.push({ startNs: openNs, endNs: this.lastNs });
    return spans;
  }

  get rejectedSpans(): RejectedSpan[] {
    const close = (span: OpenSpan | null) => (span ? [{ ...span, endS: this.latestS }] : []);
    // The same ns-to-seconds step as analyzeReading, so both give bit-identical spans.
    const seconds = (spans: NsSpan[], reason: RejectedSpan['reason']) =>
      spans.map((span): RejectedSpan => ({
        startS: (span.startNs - this.startNs!) / 1e9,
        endS: (span.endNs - this.startNs!) / 1e9,
        reason,
      }));
    // Same order as analyzeReading before its stable sort, so equal starts sort alike.
    return [
      ...this.closed,
      ...close(this.openContact),
      ...this.exposure,
      ...seconds(this.nsSpans(this.motion, this.openMotionNs), 'motion'),
      ...seconds(this.nsSpans(this.coldHands, this.openColdHandsNs), 'coldHands'),
      ...this.quality,
      ...(this.modelRan ? this.unscored : []),
      ...this.flatRuns.spans(),
      ...this.gaps,
    ].sort((x, y) => x.startS - y.startS);
  }

  // Fresh copies throughout: the caller may keep or change what it gets while the session goes on.
  readingInput(): ReturnType<LiveSession['readingInput']> {
    const startNs = this.startNs ?? 0;
    // Null until SQI-Net has scored a window, so sqiAvailable keeps capping confidence when it never ran.
    const sqi: SqiScores | null = this.modelRan
      ? {
          threshold: this.config.sqiThreshold,
          // Window ends are 64 Hz grid times, k × 15.625 ms: whole ns, so this round trip is exact.
          windows: this.scores.map(({ endS, pClean }) => ({
            endNs: startNs + Math.round(endS * 1e9),
            pClean,
          })),
        }
      : null;
    return {
      capture: {
        samples: this.samples.map((sample) => ({ ...sample })),
        stats: this.stats.map((stat) => ({ ...stat })),
      },
      motionSpans: this.nsSpans(this.motion, this.openMotionNs),
      coldHandsSpans: this.nsSpans(this.coldHands, this.openColdHandsNs),
      sqi,
    };
  }

  // What analyzeReading will count: time not covered by any span. A late SQI rejection lowers it.
  private trueCleanSeconds(): number {
    return cleanTime(0, this.latestS, this.rejectedSpans);
  }

  // The countdown never steps back (owner delegation, ADR 0042): after a late rejection it pauses until
  // the true count catches up. Results use the true value, so nothing is overstated.
  get cleanSeconds(): number {
    return Math.max(this.shownClean, this.trueCleanSeconds());
  }

  get recentWaveform(): { tS: number[]; ppg: number[] } {
    const fromS = this.latestS - DSP_CONFIG.live.waveformS;
    let first = this.count;
    while (first > 0 && this.tS[first - 1]! >= fromS) first--;
    return {
      tS: Array.from(this.tS.subarray(first, this.count)),
      ppg: Array.from(this.filtered.subarray(first, this.count)),
    };
  }

  get perfusionPct(): number | null {
    return this.livePerfusionPct;
  }

  get coachingKey(): CoachingKey | null {
    return this.coaching.key;
  }

  get sqiWindow(): SqiWindow | null {
    return this.latestWindow;
  }
}

/** §9.3 LiveSession: live waveform, SQI windows, rejected spans, clean seconds, and coaching. */
export function createLiveSession(config: LiveSessionConfig): LiveSession {
  return new Session(config);
}
