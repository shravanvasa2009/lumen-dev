import { longPauseReference } from './beat-classes';
import { DSP_CONFIG } from './config';
import type { RejectedSpan } from './live-session';
import { median } from './median';
import type { BeatInterval, ReadingAnalysis } from './reading';
import { cleanSeconds } from './reading-metrics';

// §10.1 Emergency screen, the heart-rate parts (ADR 0076). Only rule-based beats and spans are used
// (DSP-4/DSP-5/DSP-9, DSP-11): the rule reads the SQI-free intervals and spans when SQI-Net ran, so no AI
// output can raise or suppress either field.
export interface UrgentHeartRate {
  // HR > 150 bpm sustained 60 s at rest: the Emergency screen on its own.
  fastSustained: boolean;
  // The reading's HR < 40 bpm: the Emergency screen only with symptoms, which the app asks for.
  slowBelow40: boolean;
}

// Whole device-clock ns, so sums and gaps compare exactly: 160 × 375 ms is 60 s, and a 6.000 s break is
// 6e9 ns wherever it falls (red team v2 N5).
interface CleanInterval {
  startNs: number;
  endNs: number;
  ns: number;
}

// Accepted intervals (both beats non-artifact, DSP-11) that touch no rejected span, in time order.
function cleanIntervals(intervals: BeatInterval[], rejectedSpans: RejectedSpan[], startNs: number) {
  return intervals
    .flatMap((interval): CleanInterval[] => {
      if (!interval.accepted || !(interval.ibiMs > 0)) return [];
      const ns = Math.round(interval.ibiMs * 1e6);
      const endNs = Math.round(interval.tNs);
      const endS = (endNs - startNs) / 1e9;
      const startS = endS - ns / 1e9;
      const touched = rejectedSpans.some((span) => span.startS < endS && span.endS > startS);
      return touched ? [] : [{ startNs: endNs - ns, endNs, ns }];
    })
    .sort((x, y) => x.endNs - y.endNs);
}

// Beats per clean interval: a DSP-9 long pause (≥ longPauseRatio × the median of its DSP-9 neighbours,
// the same reference DSP-9 uses) counts as round(interval / that median) beats, any other interval as 1.
// A beat missed in noise (one ≈ 2× interval) then counts as the 2 beats it spans, so it no longer pulls
// the rate down (red team v2 N1). A real pause counted as 2 raises the rate: the safe side for this rule.
// DSP-9 withholds the judgement near segment edges to protect HRV; here every clean interval is judged.
function beatCounts(intervals: CleanInterval[]): number[] {
  const { longPauseRatio } = DSP_CONFIG.dsp9;
  const lengths = intervals.map(({ ns }) => ns);
  return lengths.map((ns, q) => {
    const reference = longPauseReference(lengths, q);
    return reference !== null && ns >= longPauseRatio * reference ? Math.round(ns / reference) : 1;
  });
}

// A point is the window of the last windowS clean seconds of intervals up to one interval. It is fast when
// it holds ≥ windowMinCleanS clean seconds and 60 × its beats / its summed intervals clears fastBpm. The
// sum is exact for any repeating pattern (alternating, period 3 or 4, a premature beat with its
// compensatory pause, all under 1.6×), where a median interval or two-beat span flips between values
// (red team v1 F1, v2 N2). A run of consecutive fast points counts its first window and then each
// interval, and must reach sustainS clean seconds. A gap between clean intervals up to maxBreakS is
// bridged but never counted; a longer one restarts the window and the count.
function sustainedFast(intervals: CleanInterval[]): boolean {
  const { fastBpm, fastMarginBpm, sustainS, windowS, windowMinCleanS, maxBreakS } =
    DSP_CONFIG.rules.emergency;
  const beats = beatCounts(intervals);
  let windowFirst = 0;
  let windowNs = 0;
  let windowBeats = 0;
  let inRun = false;
  let runNs = 0;
  for (let k = 0; k < intervals.length; k++) {
    const interval = intervals[k]!;
    const previous = intervals[k - 1];
    if (previous && interval.startNs - previous.endNs > maxBreakS * 1e9) {
      windowFirst = k;
      windowNs = 0;
      windowBeats = 0;
      inRun = false;
    }
    windowNs += interval.ns;
    windowBeats += beats[k]!;
    // An interval longer than windowS leaves the window empty.
    while (windowNs > windowS * 1e9 && windowFirst <= k) {
      windowNs -= intervals[windowFirst]!.ns;
      windowBeats -= beats[windowFirst]!;
      windowFirst++;
    }
    const fast =
      windowNs >= windowMinCleanS * 1e9 && (60e9 * windowBeats) / windowNs > fastBpm + fastMarginBpm;
    if (!fast) {
      inRun = false;
      continue;
    }
    runNs = inRun ? runNs + interval.ns : windowNs;
    inRun = true;
    if (runNs >= sustainS * 1e9) return true;
  }
  return false;
}

// DSP-11's HR without SQI-Net (red team v2 N3): 60 / the median accepted interval once the SQI-free spans
// leave ≥ minCleanS clean seconds, as heartRate gives with sqi null; an interval bridging a beat found
// twice is not accepted, as in intervals. With no SQI-Net run it is the reading's HR.
function heartRateWithoutSqiNet(analysis: ReadingAnalysis): number | null {
  if (!analysis.withoutSqiNet) return analysis.heartRateBpm;
  const { intervals, rejectedSpans } = analysis.withoutSqiNet;
  if (!(cleanSeconds(0, analysis.durationS, rejectedSpans) >= DSP_CONFIG.dsp11.minCleanS)) return null;
  const acceptedMs = intervals.flatMap((interval) =>
    interval.accepted && interval.ibiMs > 0 ? [interval.ibiMs] : [],
  );
  return acceptedMs.length > 0 ? 60000 / median(acceptedMs) : null;
}

/** §10.1 Emergency screen heart-rate triggers; null when neither holds. */
export function emergencyHeartRate(analysis: ReadingAnalysis): UrgentHeartRate | null {
  const { slowBpm, slowMarginBpm } = DSP_CONFIG.rules.emergency;
  const { intervals, rejectedSpans } = analysis.withoutSqiNet ?? analysis;
  // "At rest" is the §7 rest timer, as for the §10.1 resting rules.
  const fastSustained =
    analysis.context.restTimerDone &&
    sustainedFast(cleanIntervals(intervals, rejectedSpans, analysis.startNs));
  const heartRateBpm = heartRateWithoutSqiNet(analysis);
  const slowBelow40 = heartRateBpm !== null && heartRateBpm < slowBpm - slowMarginBpm;
  return fastSustained || slowBelow40 ? { fastSustained, slowBelow40 } : null;
}
