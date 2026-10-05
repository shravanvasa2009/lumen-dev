import { DSP_CONFIG } from './config';
import type { RejectedSpan } from './live-session';
import { median } from './median';
import type { BeatInterval, ReadingAnalysis } from './reading';
import { cleanSeconds } from './reading-metrics';

// §10.1 Emergency screen, the heart-rate parts (ADR 0076). Only rule-based beats and spans are used
// (DSP-4/DSP-5/DSP-9, DSP-11): the rule reads the reading's emergency view (withoutSqiNet), so no AI
// output can raise or suppress either field, and ADR 0077's frame floor does not hide a fast pulse (owner,
// "242 A").
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

// The window's rolling HR: the larger of the mean rate (60 × intervals / their sum) and the median-interval
// rate (60 / the median interval, DSP-11's estimate). Each is a standard HR estimate and each covers what the
// other misses (ADR 0076):
// - beats missed in noise (≈ 2× intervals, red team v2 N1, v3 R2) lengthen a minority of intervals, so the
//   median keeps the true rate where the mean drops;
// - a repeating pattern (alternating, period 3 or 4, red team v1 F1, v2 N2) can flip the median between
//   values, but the mean is exact for it, as for a premature beat with its compensatory pause;
// - a blocked premature beat with sinus reset (a 1.6–1.8× pause, v3 R1) leaves the mean below the pulse and
//   the median at the sinus rate, so the rule never reads above the HR the screen shows.
function rollingBpm(lengthsNs: number[], sumNs: number): number {
  return Math.max((60e9 * lengthsNs.length) / sumNs, 60e9 / median(lengthsNs));
}

// A point is the window of the last windowS clean seconds of intervals up to one interval. It is fast when
// it holds ≥ windowMinCleanS clean seconds and its rolling HR clears fastBpm. A run of consecutive fast
// points counts its first window and then each interval, and must reach sustainS clean seconds. A gap
// between clean intervals up to maxBreakS is bridged but never counted; a longer one restarts the window
// and the count.
function sustainedFast(intervals: CleanInterval[]): boolean {
  const { fastBpm, fastMarginBpm, sustainS, windowS, windowMinCleanS, maxBreakS } =
    DSP_CONFIG.rules.emergency;
  let windowFirst = 0;
  let windowNs = 0;
  let inRun = false;
  let runNs = 0;
  for (let k = 0; k < intervals.length; k++) {
    const interval = intervals[k]!;
    const previous = intervals[k - 1];
    if (previous && interval.startNs - previous.endNs > maxBreakS * 1e9) {
      windowFirst = k;
      windowNs = 0;
      inRun = false;
    }
    windowNs += interval.ns;
    // An interval longer than windowS leaves the window empty.
    while (windowNs > windowS * 1e9 && windowFirst <= k) {
      windowNs -= intervals[windowFirst]!.ns;
      windowFirst++;
    }
    const fast =
      windowNs >= windowMinCleanS * 1e9 &&
      rollingBpm(
        intervals.slice(windowFirst, k + 1).map(({ ns }) => ns),
        windowNs,
      ) >
        fastBpm + fastMarginBpm;
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

// DSP-11's HR in the emergency view (red team v2 N3): 60 / the median accepted interval once its spans
// leave ≥ minCleanS clean seconds and its accepted intervals add up to minCleanS (ADR 0080), as heartRate
// gives; an interval bridging a beat found twice is not accepted, as in intervals. Without a view (no
// SQI-Net run, no frame-floor window) it is the reading's HR.
function heartRateWithoutSqiNet(analysis: ReadingAnalysis): number | null {
  if (!analysis.withoutSqiNet) return analysis.heartRateBpm;
  const { intervals, rejectedSpans } = analysis.withoutSqiNet;
  const { minCleanS } = DSP_CONFIG.dsp11;
  if (!(cleanSeconds(0, analysis.durationS, rejectedSpans) >= minCleanS)) return null;
  const acceptedMs = intervals.flatMap((interval) =>
    interval.accepted && interval.ibiMs > 0 ? [interval.ibiMs] : [],
  );
  let spannedMs = 0;
  for (const ibiMs of acceptedMs) spannedMs += ibiMs;
  return spannedMs >= minCleanS * 1000 ? 60000 / median(acceptedMs) : null;
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
