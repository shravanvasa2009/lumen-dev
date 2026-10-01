import type { CaptureStatus, SampleBatch } from './capture';
import { DSP_CONFIG } from './config';
import { frameProblem } from './contact';
import { butterBandpass, CausalFilter, type SosSection } from './filters';
import { sqiModelInput } from './finger-signal';
import type { CoachingKey, LiveSession, RejectedSpan, SqiWindow } from './live-session';
import { cleanSeconds as cleanTime } from './reading-metrics';
import { resampleCubic } from './resample';

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
  private count = 0;
  private startNs: number | null = null;
  private lastNs = -Infinity;
  private lastExposureNs: number | null = null;
  private filter: CausalFilter | null = null;

  private readonly closed: RejectedSpan[] = []; // contact (DSP-4)
  private readonly exposure: RejectedSpan[] = []; // DSP-5
  private readonly motion: RejectedSpan[] = [];
  private readonly coldHands: RejectedSpan[] = [];
  private readonly quality: RejectedSpan[] = [];
  private openContact: OpenSpan | null = null;
  private openMotion: OpenSpan | null = null;
  private openColdHands: OpenSpan | null = null;

  private leaking = false;
  private nextTickS: number;
  private latestWindow: SqiWindow | null = null;
  private readonly coaching = new CoachingMachine();

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
    samples.forEach((sample, i) => this.addFrame(sample, stats[i]!));
  }

  private addFrame(sample: SampleBatch['samples'][number], stat: SampleBatch['stats'][number]): void {
    this.startNs ??= sample.tNs;
    // DSP-1: seconds from the first frame, subtracted in ns first.
    const tS = (sample.tNs - this.startNs) / 1e9;
    const gap = this.count > 0 && tS - this.latestS > DSP_CONFIG.dsp2.maxGapS;
    // The causal filter assumes evenly spaced frames; after a DSP-2 gap it restarts in steady state.
    if (this.filter === null || gap) this.filter = new CausalFilter(this.sos);
    const value = this.filter.filter([-sample.r])[0]!;

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

    const at = this.count++;
    this.tS[at] = tS;
    this.red[at] = sample.r;
    this.filtered[at] = value;
    this.covered[at] = problem === 'coverage' ? 0 : 1;
    this.lastNs = sample.tNs;

    if (tS >= this.nextTickS) {
      this.tick(tS);
      const { sqiEveryS } = DSP_CONFIG.live;
      this.nextTickS = (Math.floor(tS / sqiEveryS) + 1) * sqiEveryS;
    }
    this.updateCoaching();
  }

  pushStatus(status: CaptureStatus): void {
    // Statuses carry no timestamp; each applies at the newest frame.
    if (this.count === 0) return;
    const moving = status.motionRms > DSP_CONFIG.live.motionRmsThreshold;
    if (moving && !this.openMotion) this.openMotion = { startS: this.latestS, reason: 'motion' };
    if (!moving && this.openMotion) {
      this.motion.push({ ...this.openMotion, endS: this.latestS });
      this.openMotion = null;
    }
    this.updateCoaching();
  }

  setSqi(windowEndS: number, pClean: number): void {
    if (pClean < this.config.sqiThreshold) this.rejectWindow(windowEndS);
  }

  private rejectWindow(windowEndS: number): void {
    const windowS = DSP_CONFIG.dsp3.modelWindowS;
    this.quality.push({ startS: windowEndS - windowS, endS: windowEndS, reason: 'quality' });
  }

  // First buffered frame at or after fromS, if the frames from there to the newest are covered and
  // gap-free; null otherwise or when the capture does not reach back to fromS.
  private usableFrom(fromS: number): number | null {
    if (this.count === 0 || this.tS[0]! > fromS) return null;
    let first = this.count - 1;
    while (first > 0 && this.tS[first - 1]! >= fromS) first--;
    if (first > 0) first--; // one frame before fromS, so a spline covers fromS itself
    for (let i = first; i < this.count; i++) {
      if (!this.covered[i]) return null;
      if (i > first && this.tS[i]! - this.tS[i - 1]! > DSP_CONFIG.dsp2.maxGapS) return null;
    }
    return first;
  }

  // Once per sqiEveryS: the SQI-Net window (§11.2, ADR 0023) and the cold-hands check (§7).
  private tick(tS: number): void {
    const { modelRateHz } = DSP_CONFIG.dsp2;
    const samples = DSP_CONFIG.dsp3.modelWindowS * modelRateHz;
    this.latestWindow = null;
    // Two grid steps of slack so the 64 Hz grid holds 256 points ending at or before tS.
    const first = this.usableFrom(tS - (samples + 1) / modelRateHz);
    if (first !== null) {
      const times = this.tS.slice(first, this.count);
      const red = this.red.slice(first, this.count);
      const [segment] = resampleCubic(
        times,
        red.map((value) => -value),
        modelRateHz,
      );
      if (segment && segment.values.length >= samples) {
        const values = segment.values.slice(-samples);
        const endS = (segment.firstIndex + segment.values.length - 1) / modelRateHz;
        // Flatness is judged on the frames: a spline through equal values can round to tiny wiggles that
        // z-scoring would blow up into noise.
        const flat = red.every((value) => value === red[0]);
        const input = !flat && values.every(Number.isFinite) ? sqiModelInput(values) : null;
        // ADR 0023: a flat (or broken) window never reaches the model and counts as rejected.
        if (input) this.latestWindow = { endS, input };
        else this.rejectWindow(endS);
      }
    }

    const { coldHandsAfterS, perfusionWindowS } = DSP_CONFIG.live;
    const from = tS >= coldHandsAfterS ? this.usableFrom(tS - perfusionWindowS) : null;
    let cold = false;
    if (from !== null) {
      let low = Infinity;
      let high = -Infinity;
      let total = 0;
      for (let i = from; i < this.count; i++) {
        low = Math.min(low, this.filtered[i]!);
        high = Math.max(high, this.filtered[i]!);
        total += this.red[i]!;
      }
      cold = (100 * (high - low)) / (total / (this.count - from)) < this.config.perfusionFloorPct;
    }
    if (cold && !this.openColdHands) this.openColdHands = { startS: tS, reason: 'coldHands' };
    if (!cold && this.openColdHands) {
      this.coldHands.push({ ...this.openColdHands, endS: tS });
      this.openColdHands = null;
    }
  }

  private updateCoaching(): void {
    const active = new Set<CoachingKey>();
    if (this.openContact?.reason === 'coverage') active.add('coach.cover');
    if (this.openContact?.reason === 'clipping') active.add('coach.lighter');
    if (this.leaking) active.add('coach.flat');
    if (this.openMotion) active.add('coach.still');
    if (this.openColdHands) active.add('coach.warm');
    this.coaching.update(this.latestS, active);
  }

  get rejectedSpans(): RejectedSpan[] {
    const close = (span: OpenSpan | null) => (span ? [{ ...span, endS: this.latestS }] : []);
    // Same order as analyzeReading before its stable sort, so equal starts sort alike.
    return [
      ...this.closed,
      ...close(this.openContact),
      ...this.exposure,
      ...this.motion,
      ...close(this.openMotion),
      ...this.coldHands,
      ...close(this.openColdHands),
      ...this.quality,
    ].sort((x, y) => x.startS - y.startS);
  }

  get cleanSeconds(): number {
    return cleanTime(0, this.latestS, this.rejectedSpans);
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
