import { detectBeats } from './beats';
import { classifyBeats } from './beat-classes';
import { breathingEstimates, breathingRate, type BreathingRate } from './breathing';
import type { FrameStat, Sample } from './capture';
import { DSP_CONFIG } from './config';
import { frameProblem, validChannels } from './contact';
import { butterBandpass, filterZeroPhase } from './filters';
import { fingerSignals } from './finger-signal';
import { FlatRuns, modelWindowAt, nextModelTickS, unscoredSpan } from './model-window';
import { ensembleBeat, lowQualityEnsembleBeat, type PulseShape } from './pulse-shape';
import type { RejectedSpan, RejectionReason } from './live-session';
import {
  cleanSeconds,
  frameGapSpan,
  heartRate,
  lowQualityHeartRate,
  measureBeats,
  perfusionIndex,
  type MeasuredBeat,
} from './reading-metrics';
import { resampleCubic, type ResampledSegment } from './resample';
import type { LostSeconds, RhythmClass } from './results';
import {
  hasEnoughUsableIntervals,
  readingWideWindow,
  rhythmFeatureVector,
  rhythmV2Features,
  rhythmWindows,
  type RhythmWindow,
} from './rhythm-features';
import { buildTimebase, type Timebase } from './timebase';

export type Tier = 'full' | 'basic' | 'limited';

// Native capture-clock times (ns, same clock as Sample.tNs).
export interface NsSpan {
  startNs: number;
  endNs: number;
}

// SQI-Net scores for 4 s windows ending at endNs (§11.2), and the manifest threshold for P(clean).
export interface SqiScores {
  threshold: number;
  windows: { endNs: number; pClean: number }[];
}

export interface ReadingContext {
  captureFps: number; // the capture format's frame rate (30, 60, 120), not a measured rate
  tier: Tier | null; // §5 rating tier; null when the phone has not been rated
  mode: string; // 'quick' | 'full' and later modes; diabetes needs 'full' (Full Scan)
  restTimerDone: boolean; // §10.1 resting rules
  recordedAt: { ms: number; day: string } | null; // epoch ms and local calendar day, for history rules
  motionSpans: NsSpan[]; // accelerometer RMS above the app's threshold (§7)
  coldHandsSpans: NsSpan[]; // live perfusion index under the device floor: the reading paused (§7)
  sqi: SqiScores | null; // null when SQI-Net did not run
  // Validation only (replay --rhythm-from-label, ADR 0041): a labelled rhythm that stands in for the
  // rhythm class in the DSP-12 gate when no rhythm model ran. It never makes a rhythm card. The app
  // passes null.
  validationRhythmLabel: RhythmClass | null;
}

// One row of replay-intervals.csv (the C/E contract): the interval ending at the beat peaking at tNs.
export interface BeatInterval {
  tNs: number;
  ibiMs: number;
  accepted: boolean; // both beats are normal or atypical (DSP-11, DSP-15)
  nn: boolean; // both beats normal and no long pause (DSP-12's input before its 20% filter)
}

export interface ReadingAnalysis {
  context: ReadingContext;
  startNs: number;
  durationS: number; // first to last frame
  sqiAvailable: boolean;
  // SQI-Net is advisory (owner 2026-10-06, superseding H-024's reject-only guard): windows scored under its
  // threshold stay clean and are only counted here; null when it never ran.
  sqiFlagged: { windows: number; total: number } | null;
  // Clean seconds no scored SQI-Net window covers, as when it stops scoring partway; null when it never ran.
  sqiUnscoredS: number | null;
  rejectedSpans: RejectedSpan[]; // seconds from the first frame, sorted by start
  cleanSeconds: number;
  lostSeconds: LostSeconds;
  segments: MeasuredBeat[][]; // one per analysed DSP-2 segment
  intervals: BeatInterval[];
  heartRateBpm: number | null;
  perfusionIndexPct: number | null;
  breathing: BreathingRate | null;
  normalizedRmssd: number | null; // over accepted intervals, for §10.1 fast regular rhythm
  rhythmWindows: RhythmWindow[];
  rhythmFeatures: number[][]; // per window, RHYTHM_FEATURE_NAMES order (v1 8 + v2 7): the rhythm model input
  enoughRhythmIntervals: boolean;
  usableRhythmIntervals: number; // intervals that span no artifact (DSP-15)
  pulseShape: PulseShape | null; // DSP-14 averaged beat (readingShape): diabetes-net's beat input
  // The emergency view for the §10.1 rule (ADR 0076): intervals and rejected spans without SQI-Net's spans
  // and without ADR 0077's frame-floor windows (owner, "242 A"); null when it has neither, where they are
  // the reading's own.
  withoutSqiNet: { intervals: BeatInterval[]; rejectedSpans: RejectedSpan[] } | null;
  // ADR 0104: the same math on whatever beats exist, for each output whose standard floor failed. Each is null
  // when the standard value exists, or when even these floors (lowQuality config) are not met.
  lowQuality: {
    heartRateBpm: number | null;
    breathing: BreathingRate | null;
    pulseShape: PulseShape | null;
    rhythmWindow: RhythmWindow | null; // only when no 32-interval window fits
    rhythmFeatures: number[] | null; // RHYTHM_FEATURE_NAMES order, as rhythmFeatures
  };
}

// A run of failing frames spans from its first frame to the next frame (the last frame ends the reading).
// With skipBroken, broken frames are passed over as if dropped.
function contactSpans(
  timebase: Timebase,
  samples: Sample[],
  stats: FrameStat[],
  skipBroken: boolean,
): RejectedSpan[] {
  const spans: RejectedSpan[] = [];
  const { tS } = timebase;
  let open: RejectedSpan | null = null;
  for (let i = 0; i < samples.length; i++) {
    if (skipBroken && !validChannels(samples[i]!)) continue;
    const reason = frameProblem(samples[i]!, stats[i]!);
    if (open && open.reason !== reason) {
      open.endS = tS[i]!;
      spans.push(open);
      open = null;
    }
    if (reason && !open) open = { startS: tS[i]!, endS: tS[i]!, reason };
  }
  if (open) {
    open.endS = tS[tS.length - 1]!;
    spans.push(open);
  }
  return spans;
}

// DSP-5: every exposure change marks the following 1 s.
function exposureSpans(timebase: Timebase): RejectedSpan[] {
  const spans: RejectedSpan[] = [];
  const { exposureNs, tS } = timebase;
  for (let i = 1; i < exposureNs.length; i++) {
    if (exposureNs[i] === exposureNs[i - 1]) continue;
    spans.push({
      startS: tS[i]!,
      endS: tS[i]! + DSP_CONFIG.dsp5.exposureChangeArtifactS,
      reason: 'exposure',
    });
  }
  return spans;
}

// The accelerometer and cold-hands spans.
function sensorSpans(context: ReadingContext, startNs: number): RejectedSpan[] {
  const seconds = (tNs: number) => (tNs - startNs) / 1e9;
  const fromNs = (spans: NsSpan[], reason: RejectionReason) =>
    spans.map((span): RejectedSpan => ({ startS: seconds(span.startNs), endS: seconds(span.endNs), reason }));
  return [...fromNs(context.motionSpans, 'motion'), ...fromNs(context.coldHandsSpans, 'coldHands')];
}

// Owner 2026-10-06 ("Advisory + tag"): SQI-Net v1 accepted about 64% of clean development windows, and each
// window it vetoed stopped the clean count. Its scores now reject nothing; the reading counts the windows under
// the threshold, and buildReadingResult tags the reading with them.
// Red team on #308: the scored windows inside the reading, each once by its lowest score, so repeats, their order,
// and windows outside the frames cannot dilute the flagged share. A window any score flagged counts as flagged.
function sqiWindowsInside(sqi: SqiScores | null, startNs: number, durationS: number): SqiScores | null {
  if (sqi === null) return null;
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  const lowest = new Map<number, number>();
  for (const { endNs, pClean } of sqi.windows) {
    const endS = (endNs - startNs) / 1e9;
    if (endS - windowS < 0 || endS > durationS) continue;
    lowest.set(endNs, Math.min(pClean, lowest.get(endNs) ?? pClean));
  }
  return {
    threshold: sqi.threshold,
    windows: Array.from(lowest, ([endNs, pClean]) => ({ endNs, pClean })),
  };
}

function sqiFlaggedWindows(sqi: SqiScores | null): ReadingAnalysis['sqiFlagged'] {
  if (sqi === null) return null;
  const windows = sqi.windows.filter((window) => window.pClean < sqi.threshold).length;
  return { windows, total: sqi.windows.length };
}

// Owner 2026-10-09: a rate SQI-Net never looked at is tagged, so the clean time outside every scored window
// [endS − modelWindowS, endS] is counted.
function sqiUnscoredSeconds(
  sqi: SqiScores | null,
  startNs: number,
  durationS: number,
  rejectedSpans: RejectedSpan[],
): number | null {
  if (sqi === null) return null;
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  const ends = sqi.windows.map((window) => (window.endNs - startNs) / 1e9).sort((x, y) => x - y);
  let unscored = 0;
  let scoredToS = 0;
  for (const endS of [...ends, durationS + windowS]) {
    const gapEndS = Math.min(endS - windowS, durationS);
    if (gapEndS > scoredToS) unscored += cleanSeconds(scoredToS, gapEndS, rejectedSpans);
    scoredToS = Math.max(scoredToS, endS);
  }
  return unscored;
}

// ADR 0023 flat windows (at the live session's once-per-second checks) and ADR 0057 flat runs, found
// from the frames, so they are rejected whether or not SQI-Net ran and match the live screen. Windows
// SQI-Net could not score are rejected only when it ran, so they are also listed as unscored. Windows
// under ADR 0077's frame floor are also listed as sparse, for the emergency view.
function frameQualitySpans(timebase: Timebase, samples: Sample[], stats: FrameStat[], modelRan: boolean) {
  const covered = Uint8Array.from(samples, (sample, i) =>
    frameProblem(sample, stats[i]!) === 'coverage' ? 0 : 1,
  );
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  const spans: RejectedSpan[] = [];
  const unscored: RejectedSpan[] = [];
  const sparse: RejectedSpan[] = [];
  const flatRuns = new FlatRuns();
  let nextTickS = DSP_CONFIG.live.sqiEveryS;
  let formedEndS: number | null = null;
  timebase.tS.forEach((tS, i) => {
    flatRuns.add(tS, timebase.r[i]!, covered[i] === 1);
    if (tS < nextTickS) return;
    nextTickS = nextModelTickS(tS);
    const window = modelWindowAt(timebase.tS, timebase.r, covered, i + 1);
    if (window && !window.input) {
      const span: RejectedSpan = { startS: window.endS - windowS, endS: window.endS, reason: 'quality' };
      spans.push(span);
      if (window.sparse && !window.flat) sparse.push(span);
    }
    const missing = window ? null : unscoredSpan(timebase.tS, i + 1, formedEndS);
    if (missing) unscored.push(missing);
    if (window) formedEndS = window.endS;
  });
  const rejectedUnscored = modelRan ? unscored : [];
  // In LiveSession's order, so equal starts sort alike.
  return { all: [...spans, ...rejectedUnscored, ...flatRuns.spans()], unscored: rejectedUnscored, sparse };
}

function lostSecondsOf(spans: RejectedSpan[], durationS: number): LostSeconds {
  // §7 coaching causes. Clipping is the saturated DC of pressing too hard; quality and exposure spans are
  // not coaching causes. Cold-hands pauses come from the live session (ADR 0042).
  const lost = (reasons: RejectionReason[]) =>
    durationS -
    cleanSeconds(
      0,
      durationS,
      spans.filter((span) => reasons.includes(span.reason)),
    );
  return {
    motion: lost(['motion']),
    pressure: lost(['clipping']),
    coverage: lost(['coverage']),
    coldHands: lost(['coldHands']),
  };
}

// DSP-6 morphology band of one resampled segment.
function morphologyBand(segment: ResampledSegment, rateHz: number): ResampledSegment {
  const { morphologyOrder, morphologyBandHz } = DSP_CONFIG.dsp6;
  const [lowHz, highHz] = morphologyBandHz as [number, number];
  return {
    firstIndex: segment.firstIndex,
    values: filterZeroPhase(butterBandpass(morphologyOrder, lowHz, highHz, rateHz), segment.values),
  };
}

interface BeatSegment {
  beats: MeasuredBeat[];
  shape: ResampledSegment; // DSP-6 morphology band at 256 Hz
  beatsWithoutSqiNet: MeasuredBeat[] | null; // classed in the emergency view's spans; null without one
}

// DSP-2 to DSP-9 per segment, then the DSP-10/13 per-beat values. Segments shorter than dsp7.minSegmentS
// are not searched for beats. DSP-9 classes the same detected beats again against spansWithoutSqiNet.
function beatSegments(
  timebase: Timebase,
  samples: Sample[],
  stats: FrameStat[],
  spans: RejectedSpan[],
  spansWithoutSqiNet: RejectedSpan[] | null,
): BeatSegment[] {
  const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
  const { primary } = fingerSignals(timebase);
  // An uncovered frame holds no finger signal (DSP-3), only ambient light or a broken value, and left in
  // it is a step that swamps DSP-7 over the whole segment (red team PR #171 round 3). It is left out as if
  // dropped, as the SQI-Net window does (ADR 0057): DSP-2 splines across it when the frames either side
  // are within its gap limit, and splits there otherwise. Its coverage span still makes a beat there an
  // artifact (DSP-9 lost contact). Clipped frames are covered and stay.
  const kept = samples.flatMap((sample, i) => (frameProblem(sample, stats[i]!) === 'coverage' ? [] : [i]));
  const keptS = Float64Array.from(kept, (i) => timebase.tS[i]!);
  const keptSignal = Float64Array.from(kept, (i) => primary[i]!);
  const models = resampleCubic(keptS, keptSignal, modelRateHz);
  const shapes = resampleCubic(keptS, keptSignal, shapeRateHz);
  // The two rates split at the same gaps, but a very short segment can lack a grid point at 64 Hz, so
  // the pairs are matched by time; at most one overlaps.
  const span = (segment: ResampledSegment, rateHz: number) =>
    [segment.firstIndex / rateHz, (segment.firstIndex + segment.values.length - 1) / rateHz] as const;
  return shapes.flatMap((raw) => {
    if (raw.values.length < DSP_CONFIG.dsp7.minSegmentS * shapeRateHz) return [];
    const [startS, endS] = span(raw, shapeRateHz);
    const model = models.find((candidate) => {
      const [from, to] = span(candidate, modelRateHz);
      return from <= endS && to >= startS;
    })!;
    const shape = morphologyBand(raw, shapeRateHz);
    const detected = detectBeats(morphologyBand(model, modelRateHz), shape);
    const measured = (against: RejectedSpan[]) =>
      measureBeats(detected, classifyBeats(detected, shape, against), raw);
    return [
      {
        beats: measured(spans),
        shape,
        beatsWithoutSqiNet: spansWithoutSqiNet && measured(spansWithoutSqiNet),
      },
    ];
  });
}

// One segment's beats that are not "not a beat". Two beats at the same or reversed times are one beat found
// twice, not a cardiac cycle (as heartRate): the later-listed one is left out, and the interval that
// bridges it (ending at the next kept beat) is not used, so no interval is ≤ 0 (DSP-7, DSP-15, ADR 0068).
function distinctBeats(segment: MeasuredBeat[]): { beat: MeasuredBeat; bridgesDuplicate: boolean }[] {
  const kept: { beat: MeasuredBeat; bridgesDuplicate: boolean }[] = [];
  let bridgesDuplicate = false;
  for (const beat of segment) {
    if (beat.beatClass === 'not-a-beat') continue;
    const previous = kept[kept.length - 1];
    if (previous && !(beat.peakS > previous.beat.peakS)) {
      bridgesDuplicate = true;
      continue;
    }
    kept.push({ beat, bridgesDuplicate });
    bridgesDuplicate = false;
  }
  return kept;
}

// DSP-14 called as ML-6 training calls it on a 90 s VitalDB segment (ml/train/diabetes_features.py):
// onsets of every beat that is not "not a beat" and has an onset, in 256 Hz samples of the segment, and
// normal = class "normal". The fps is the capture format's: DSP-14 gates on the configured rate, and
// VitalDB's 500 Hz is exact.
type AverageBeat = (
  morphology256: ArrayLike<number>,
  onsets: number[],
  normal: boolean[],
) => PulseShape | null;

function segmentShape(segment: BeatSegment, average: AverageBeat): PulseShape | null {
  const { shapeRateHz } = DSP_CONFIG.dsp2;
  const onsets: number[] = [];
  const normal: boolean[] = [];
  for (const beat of segment.beats) {
    if (beat.beatClass === 'not-a-beat' || beat.onsetS === null) continue;
    onsets.push(beat.onsetS * shapeRateHz - segment.shape.firstIndex);
    normal.push(beat.beatClass === 'normal');
  }
  return average(segment.shape.values, onsets, normal);
}

// Training has one gap-free segment per scan, and ensembleBeat averages one signal. A reading split at a
// gap tries its segments from longest to shortest (the first on a tie) and keeps the first that gives a
// shape, so a long flat or moving stretch does not hide a shorter segment with a clean pulse.
function readingShape(segments: BeatSegment[], average: AverageBeat): PulseShape | null {
  const byLength = [...segments].sort((x, y) => y.shape.values.length - x.shape.values.length);
  for (const segment of byLength) {
    const shape = segmentShape(segment, average);
    if (shape) return shape;
  }
  return null;
}

// Intervals per segment, between consecutive distinct beats; none crosses a segment gap.
function intervalsBySegment(segments: MeasuredBeat[][], startNs: number): BeatInterval[][] {
  const toNs = (peakS: number) => startNs + Math.round(peakS * 1e9);
  return segments.map((segment) => {
    const beats = distinctBeats(segment);
    return beats.slice(1).map(({ beat: to, bridgesDuplicate }, i) => {
      const from = beats[i]!.beat;
      const tNs = toNs(to.peakS);
      return {
        tNs,
        ibiMs: (tNs - toNs(from.peakS)) / 1e6,
        accepted: !bridgesDuplicate && from.beatClass !== 'artifact' && to.beatClass !== 'artifact',
        nn: !bridgesDuplicate && from.beatClass === 'normal' && to.beatClass === 'normal' && !to.longPause,
      };
    });
  });
}

// DSP-15 inputs over the whole reading: an interval spans an artifact when either beat is one, when it
// bridges a beat found twice, or when it crosses a segment gap (segments do not overlap in time).
function rhythmInputs(segments: MeasuredBeat[][]) {
  const beats: MeasuredBeat[] = [];
  const spansArtifact: boolean[] = [];
  const intervalsS: number[] = [];
  for (const segment of segments) {
    distinctBeats(segment).forEach(({ beat, bridgesDuplicate }, i) => {
      const previous = beats[beats.length - 1];
      if (previous) {
        intervalsS.push(beat.peakS - previous.peakS);
        spansArtifact.push(
          i === 0 || bridgesDuplicate || previous.beatClass === 'artifact' || beat.beatClass === 'artifact',
        );
      }
      beats.push(beat);
    });
  }
  return { intervalsS, spansArtifact, atypicalBeats: beats.map((beat) => beat.beatClass === 'atypical') };
}

// RMSSD / mean interval over accepted intervals (unitless); successive differences only between accepted neighbours
// of one segment, which share a beat.
function normalizedRmssdOf(bySegment: BeatInterval[][]): number | null {
  let total = 0;
  let count = 0;
  let squares = 0;
  let differences = 0;
  for (const intervals of bySegment) {
    intervals.forEach((interval, i) => {
      if (!interval.accepted) return;
      total += interval.ibiMs;
      count++;
      const previous = intervals[i - 1];
      if (!previous?.accepted) return;
      squares += (interval.ibiMs - previous.ibiMs) ** 2;
      differences++;
    });
  }
  return differences > 0 ? Math.sqrt(squares / differences) / (total / count) : null;
}

/** DSP-1 to DSP-15 over one capture, with DSP-4/DSP-5, motion, and SQI rejected spans. */
export function analyzeReading(
  capture: { samples: Sample[]; stats: FrameStat[] },
  context: ReadingContext,
): ReadingAnalysis {
  const timebase = buildTimebase(capture.samples, capture.stats);
  const durationS = timebase.tS[timebase.tS.length - 1]!;
  const modelRan = context.sqi !== null;
  const scoredWindows = sqiWindowsInside(context.sqi, timebase.startNs, durationS);
  const frameQuality = frameQualitySpans(timebase, capture.samples, capture.stats, modelRan);
  const otherSpans = [
    ...exposureSpans(timebase),
    ...sensorSpans(context, timebase.startNs),
    ...frameQuality.all,
  ];
  // The §10.1 emergency view leaves out the windows SQI-Net could not score (ADR 0076 item 2) and the
  // frame-floor windows (owner, "242 A"), so neither the model's presence nor the frame floor can raise or hide
  // the trigger. SQI-Net's scores reject nothing anywhere (owner 2026-10-06).
  const notInEmergencySpans = new Set([...frameQuality.unscored, ...frameQuality.sparse]);
  const emergencyView = modelRan || frameQuality.sparse.length > 0;
  const inEmergencyView = (span: RejectedSpan) => !notInEmergencySpans.has(span);
  const byStart = (x: RejectedSpan, y: RejectedSpan) => x.startS - y.startS;
  // Frame gaps count against clean seconds only, last in LiveSession's order (frameGapSpan).
  const gapSpans = Array.from(timebase.tS.subarray(1), (tS, i) => frameGapSpan(timebase.tS[i]!, tS)).filter(
    (span) => span !== null,
  );
  const rejectedSpans = [
    ...contactSpans(timebase, capture.samples, capture.stats, false),
    ...otherSpans,
    ...gapSpans,
  ].sort(byStart);
  const clean = cleanSeconds(0, durationS, rejectedSpans);
  // A broken frame keeps its coverage span for clean seconds, but beats are classified as if it were
  // dropped (ADR 0057): a dropped frame does not make a beat an artifact.
  const signalSpans = [...contactSpans(timebase, capture.samples, capture.stats, true), ...otherSpans].sort(
    byStart,
  );

  const bands = beatSegments(
    timebase,
    capture.samples,
    capture.stats,
    signalSpans,
    emergencyView ? signalSpans.filter(inEmergencyView) : null,
  );
  const segments = bands.map((segment) => segment.beats);
  const bySegment = intervalsBySegment(segments, timebase.startNs);
  const { intervalsS, spansArtifact, atypicalBeats } = rhythmInputs(segments);
  // rhythmWindows takes one flag per beat; with no beat at all there is nothing to window.
  const windows = atypicalBeats.length > 0 ? rhythmWindows(intervalsS, spansArtifact, atypicalBeats) : [];
  const wideWindow =
    windows.length === 0 && atypicalBeats.length > 0
      ? readingWideWindow(intervalsS, spansArtifact, atypicalBeats)
      : null;
  const heartRateBpm = heartRate(segments, clean);
  const breathing = breathingRate(segments, clean);
  const pulseShape = readingShape(bands, (morphology256, onsets, normal) =>
    ensembleBeat(morphology256, onsets, normal, context.captureFps),
  );

  return {
    context,
    startNs: timebase.startNs,
    durationS,
    sqiAvailable: modelRan,
    sqiFlagged: sqiFlaggedWindows(scoredWindows),
    sqiUnscoredS: sqiUnscoredSeconds(scoredWindows, timebase.startNs, durationS, rejectedSpans),
    rejectedSpans,
    cleanSeconds: clean,
    lostSeconds: lostSecondsOf(rejectedSpans, durationS),
    segments,
    intervals: bySegment.flat(),
    heartRateBpm,
    perfusionIndexPct: perfusionIndex(segments, clean),
    breathing,
    normalizedRmssd: normalizedRmssdOf(bySegment),
    rhythmWindows: windows,
    rhythmFeatures: windows.map((window) => [...rhythmFeatureVector(window), ...rhythmV2Features(window)]),
    enoughRhythmIntervals: hasEnoughUsableIntervals(spansArtifact),
    usableRhythmIntervals: spansArtifact.filter((spans) => !spans).length,
    pulseShape,
    withoutSqiNet: emergencyView
      ? {
          intervals: intervalsBySegment(
            bands.map((band) => band.beatsWithoutSqiNet ?? band.beats),
            timebase.startNs,
          ).flat(),
          rejectedSpans: rejectedSpans.filter(inEmergencyView),
        }
      : null,
    lowQuality: {
      heartRateBpm: heartRateBpm === null ? lowQualityHeartRate(segments) : null,
      breathing: breathing === null ? breathingEstimates(segments) : null,
      pulseShape: pulseShape === null ? readingShape(bands, lowQualityEnsembleBeat) : null,
      rhythmWindow: wideWindow,
      rhythmFeatures: wideWindow && [...rhythmFeatureVector(wideWindow), ...rhythmV2Features(wideWindow)],
    },
  };
}
