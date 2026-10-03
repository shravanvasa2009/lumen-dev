import { DSP_CONFIG } from './config';
import type { RejectedSpan } from './live-session';
import { median } from './median';
import type { BeatInterval, ReadingAnalysis } from './reading';

// §10.1 Emergency screen, the heart-rate parts (ADR 0076). Only rule-based beats and spans are used
// (DSP-4/DSP-5/DSP-9, DSP-11): the rule reads the SQI-free intervals and spans when SQI-Net ran, so no AI
// output can raise or suppress either field.
export interface UrgentHeartRate {
  // HR > 150 bpm sustained 60 s at rest: the Emergency screen on its own.
  fastSustained: boolean;
  // The reading's HR < 40 bpm: the Emergency screen only with symptoms, which the app asks for.
  slowBelow40: boolean;
}

// Seconds from the first frame, as rejectedSpans.
interface CleanInterval {
  startS: number;
  endS: number;
  ms: number;
}

// Accepted intervals (both beats non-artifact, DSP-11) that touch no rejected span, in time order.
function cleanIntervals(intervals: BeatInterval[], rejectedSpans: RejectedSpan[], startNs: number) {
  return intervals
    .flatMap((interval): CleanInterval[] => {
      if (!interval.accepted || !(interval.ibiMs > 0)) return [];
      const endS = (interval.tNs - startNs) / 1e9;
      const startS = endS - interval.ibiMs / 1000;
      const touched = rejectedSpans.some((span) => span.startS < endS && span.endS > startS);
      return touched ? [] : [{ startS, endS, ms: interval.ibiMs }];
    })
    .sort((x, y) => x.endS - y.endS);
}

// Two intervals share a beat when one starts where the other ends; 1 µs absorbs the ns-to-s rounding.
const SAME_BEAT_S = 1e-6;

// A point is the window of the last windowS clean seconds of intervals up to one interval. It is fast when
// it holds ≥ windowMinCleanS clean seconds and 120000 / the median two-beat span (the sum of two adjacent
// intervals, in ms) clears fastBpm. A span keeps a premature beat (kept as atypical, DSP-9) with its
// compensatory pause, and an alternating long/short rhythm, at the underlying rate, where a median interval
// flips between the two; the median keeps a beat missed in noise from pulling the rate down, as a mean
// would. A run of consecutive fast points counts its first window and then each interval, and must reach
// sustainS clean seconds. A gap between clean intervals up to maxBreakS is bridged but never counted; a
// longer one restarts the window and the count.
function sustainedFast(intervals: CleanInterval[]): boolean {
  const { fastBpm, fastMarginBpm, sustainS, windowS, windowMinCleanS, maxBreakS } =
    DSP_CONFIG.rules.emergency;
  // Sums in ms, so whole-ms intervals add exactly: 160 × 375 ms is 60000 ms, not 59.99999 s.
  let windowFirst = 0;
  let windowMs = 0;
  let inRun = false;
  let runMs = 0;
  for (let k = 0; k < intervals.length; k++) {
    const interval = intervals[k]!;
    const previous = intervals[k - 1];
    if (previous && interval.startS - previous.endS > maxBreakS) {
      windowFirst = k;
      windowMs = 0;
      inRun = false;
    }
    windowMs += interval.ms;
    // An interval longer than windowS leaves the window empty.
    while (windowMs > 1000 * windowS && windowFirst <= k) {
      windowMs -= intervals[windowFirst]!.ms;
      windowFirst++;
    }
    const twoBeatMs: number[] = [];
    for (let j = windowFirst + 1; j <= k; j++) {
      const [first, second] = [intervals[j - 1]!, intervals[j]!];
      if (Math.abs(second.startS - first.endS) < SAME_BEAT_S) twoBeatMs.push(first.ms + second.ms);
    }
    const fast =
      windowMs >= 1000 * windowMinCleanS &&
      twoBeatMs.length > 0 &&
      120000 / median(twoBeatMs) > fastBpm + fastMarginBpm;
    if (!fast) {
      inRun = false;
      continue;
    }
    runMs = inRun ? runMs + interval.ms : windowMs;
    inRun = true;
    if (runMs >= 1000 * sustainS) return true;
  }
  return false;
}

/** §10.1 Emergency screen heart-rate triggers; null when neither holds. */
export function emergencyHeartRate(analysis: ReadingAnalysis): UrgentHeartRate | null {
  const { slowBpm } = DSP_CONFIG.rules.emergency;
  const { intervals, rejectedSpans } = analysis.withoutSqiNet ?? analysis;
  // "At rest" is the §7 rest timer, as for the §10.1 resting rules.
  const fastSustained =
    analysis.context.restTimerDone &&
    sustainedFast(cleanIntervals(intervals, rejectedSpans, analysis.startNs));
  const slowBelow40 = analysis.heartRateBpm !== null && analysis.heartRateBpm < slowBpm;
  return fastSustained || slowBelow40 ? { fastSustained, slowBelow40 } : null;
}
