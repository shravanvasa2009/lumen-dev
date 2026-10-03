import { DSP_CONFIG } from './config';
import { median } from './median';
import type { ReadingAnalysis } from './reading';

// §10.1 Emergency screen, the heart-rate parts (ADR 0076). Only signal-derived beats are used (DSP-9,
// DSP-11): no AI output can raise either field. SQI-Net can only remove clean time.
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
function cleanIntervals(analysis: ReadingAnalysis): CleanInterval[] {
  return analysis.intervals
    .flatMap((interval) => {
      if (!interval.accepted || !(interval.ibiMs > 0)) return [];
      const endS = (interval.tNs - analysis.startNs) / 1e9;
      const startS = endS - interval.ibiMs / 1000;
      const touched = analysis.rejectedSpans.some((span) => span.startS < endS && span.endS > startS);
      return touched ? [] : [{ startS, endS, ms: interval.ibiMs }];
    })
    .sort((x, y) => x.endS - y.endS);
}

// A point is the window of clean intervals that ends at one interval and starts within windowS before
// its end. It is fast when it holds ≥ windowMinCleanS clean seconds and its median-interval HR is above
// fastBpm. A run of consecutive fast points covers its first window to its last interval, and the clean
// seconds of that cover must reach sustainS. So a break (motion, an SQI window) is bridged but never
// counted, and a break longer than windowS − windowMinCleanS always restarts the count.
function sustainedFast(intervals: CleanInterval[]): boolean {
  const { fastBpm, sustainS, windowS, windowMinCleanS } = DSP_CONFIG.rules.emergency;
  // Sums in ms, so whole-ms intervals add exactly: 160 × 375 ms is 60000 ms, not 59.99999 s.
  let windowFirst = 0;
  let windowMs = 0;
  let inRun = false;
  let runMs = 0;
  for (let k = 0; k < intervals.length; k++) {
    const interval = intervals[k]!;
    windowMs += interval.ms;
    while (intervals[windowFirst]!.startS < interval.endS - windowS) {
      windowMs -= intervals[windowFirst]!.ms;
      windowFirst++;
    }
    // Too little clean time to judge (the opening seconds, or breaks inside the window), or not fast.
    // 60000 / ms, not 60 / s: a 400 ms interval is exactly 150 bpm.
    const window = intervals.slice(windowFirst, k + 1).map((item) => item.ms);
    const fast = windowMs >= 1000 * windowMinCleanS && 60000 / median(window) > fastBpm;
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
  // "At rest" is the §7 rest timer, as for the §10.1 resting rules.
  const fastSustained = analysis.context.restTimerDone && sustainedFast(cleanIntervals(analysis));
  const slowBelow40 = analysis.heartRateBpm !== null && analysis.heartRateBpm < slowBpm;
  return fastSustained || slowBelow40 ? { fastSustained, slowBelow40 } : null;
}
