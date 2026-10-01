import { detectBeats } from './beats';
import { classifyBeats } from './beat-classes';
import { breathingRate, type BreathingRate } from './breathing';
import type { FrameStat, Sample } from './capture';
import { DSP_CONFIG } from './config';
import { frameProblem } from './contact';
import { butterBandpass, filterZeroPhase } from './filters';
import { fingerSignals } from './finger-signal';
import type { RejectedSpan, RejectionReason } from './live-session';
import { cleanSeconds, heartRate, measureBeats, perfusionIndex, type MeasuredBeat } from './reading-metrics';
import { resampleCubic, type ResampledSegment } from './resample';
import type { LostSeconds, RhythmClass } from './results';
import {
  hasEnoughUsableIntervals,
  rhythmFeatureVector,
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
  rhythmFeatures: number[][]; // rhythmFeatureVector per window: the Rhythm-Net / LightGBM input
  enoughRhythmIntervals: boolean;
}

// A run of failing frames spans from its first frame to the next frame (the last frame ends the reading).
function contactSpans(timebase: Timebase, samples: Sample[], stats: FrameStat[]): RejectedSpan[] {
  const spans: RejectedSpan[] = [];
  const { tS } = timebase;
  let open: RejectedSpan | null = null;
  for (let i = 0; i < samples.length; i++) {
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

function callerSpans(context: ReadingContext, startNs: number): RejectedSpan[] {
  const seconds = (tNs: number) => (tNs - startNs) / 1e9;
  const fromNs = (spans: NsSpan[], reason: RejectionReason) =>
    spans.map((span): RejectedSpan => ({ startS: seconds(span.startNs), endS: seconds(span.endNs), reason }));
  const motion = fromNs(context.motionSpans, 'motion');
  const coldHands = fromNs(context.coldHandsSpans, 'coldHands');
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  const { sqi } = context;
  const quality = (sqi?.windows ?? [])
    .filter((window) => sqi !== null && window.pClean < sqi.threshold)
    .map((window): RejectedSpan => ({
      startS: seconds(window.endNs) - windowS,
      endS: seconds(window.endNs),
      reason: 'quality',
    }));
  return [...motion, ...coldHands, ...quality];
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

// DSP-2 to DSP-9 per segment, then the DSP-10/13 per-beat values. Segments shorter than dsp7.minSegmentS
// are not searched for beats.
function beatSegments(timebase: Timebase, spans: RejectedSpan[]): MeasuredBeat[][] {
  const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
  const { primary } = fingerSignals(timebase);
  const models = resampleCubic(timebase.tS, primary, modelRateHz);
  const shapes = resampleCubic(timebase.tS, primary, shapeRateHz);
  // The two rates split at the same gaps, but a very short segment can lack a grid point at 64 Hz, so
  // the pairs are matched by time; segments are > 150 ms apart, so at most one overlaps.
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
    return [measureBeats(detected, classifyBeats(detected, shape, spans), raw)];
  });
}

// Intervals per segment, between consecutive beats that are not "not a beat"; none crosses a segment gap.
function intervalsBySegment(segments: MeasuredBeat[][], startNs: number): BeatInterval[][] {
  const toNs = (peakS: number) => startNs + Math.round(peakS * 1e9);
  return segments.map((segment) => {
    const beats = segment.filter((beat) => beat.beatClass !== 'not-a-beat');
    return beats.slice(1).map((to, i) => {
      const from = beats[i]!;
      const tNs = toNs(to.peakS);
      return {
        tNs,
        ibiMs: (tNs - toNs(from.peakS)) / 1e6,
        accepted: from.beatClass !== 'artifact' && to.beatClass !== 'artifact',
        nn: from.beatClass === 'normal' && to.beatClass === 'normal' && !to.longPause,
      };
    });
  });
}

// DSP-15 inputs over the whole reading: an interval spans an artifact when either beat is one, or when it
// crosses a segment gap.
function rhythmInputs(segments: MeasuredBeat[][]) {
  const beats: MeasuredBeat[] = [];
  const spansArtifact: boolean[] = [];
  const intervalsS: number[] = [];
  for (const segment of segments) {
    segment
      .filter((beat) => beat.beatClass !== 'not-a-beat')
      .forEach((beat, i) => {
        const previous = beats[beats.length - 1];
        if (previous) {
          intervalsS.push(beat.peakS - previous.peakS);
          spansArtifact.push(i === 0 || previous.beatClass === 'artifact' || beat.beatClass === 'artifact');
        }
        beats.push(beat);
      });
  }
  return { intervalsS, spansArtifact, atypicalBeats: beats.map((beat) => beat.beatClass === 'atypical') };
}

// RMSSD / mean over accepted intervals, in ms; successive differences only between accepted neighbours
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

/**
 * The reading pipeline from Appendix A samples and frame stats to everything the decision rules need:
 * DSP-1 to DSP-13 and DSP-15, with acquisition spans from DSP-4, DSP-5, motion, and SQI scores.
 */
export function analyzeReading(
  capture: { samples: Sample[]; stats: FrameStat[] },
  context: ReadingContext,
): ReadingAnalysis {
  const timebase = buildTimebase(capture.samples, capture.stats);
  const durationS = timebase.tS[timebase.tS.length - 1]!;
  const rejectedSpans = [
    ...contactSpans(timebase, capture.samples, capture.stats),
    ...exposureSpans(timebase),
    ...callerSpans(context, timebase.startNs),
  ].sort((x, y) => x.startS - y.startS);
  const clean = cleanSeconds(0, durationS, rejectedSpans);

  const segments = beatSegments(timebase, rejectedSpans);
  const bySegment = intervalsBySegment(segments, timebase.startNs);
  const { intervalsS, spansArtifact, atypicalBeats } = rhythmInputs(segments);
  const windows = rhythmWindows(intervalsS, spansArtifact, atypicalBeats);

  return {
    context,
    startNs: timebase.startNs,
    durationS,
    sqiAvailable: context.sqi !== null,
    rejectedSpans,
    cleanSeconds: clean,
    lostSeconds: lostSecondsOf(rejectedSpans, durationS),
    segments,
    intervals: bySegment.flat(),
    heartRateBpm: heartRate(segments, clean),
    perfusionIndexPct: perfusionIndex(segments, clean),
    breathing: breathingRate(segments, clean),
    normalizedRmssd: normalizedRmssdOf(bySegment),
    rhythmWindows: windows,
    rhythmFeatures: windows.map(rhythmFeatureVector),
    enoughRhythmIntervals: hasEnoughUsableIntervals(spansArtifact),
  };
}
