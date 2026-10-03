import { analyzeReading, estimateLiveHeartRate, type ReadingContext, type RatingMeasures } from '@lumen/core';

import type { KeptCapture } from '@/measure/keptCapture';
import type { PracticeSummary } from '@/store/deviceRating';

const NS_PER_S = 1e9;
const NS_PER_MS = 1e6;

// Only the frames and the clock matter here: the rating reads perfusion, never a verdict about the rhythm.
const practiceContext = (captureFps: number): ReadingContext => ({
  captureFps,
  tier: null,
  mode: 'quick',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
});

function intervalsNs(capture: KeptCapture): number[] {
  return capture.samples.slice(1).map((sample, index) => sample.tNs - capture.samples[index]!.tNs);
}

// Spec ยง5.1: achieved fps and the SD of frame intervals come from the frames' own clock; the pulse's
// perfusion index (DSP-10) and spectral SNR (the live estimator's) come from the same frames. A pulse the
// estimator cannot find leaves coupling null, so the rating stays open instead of scoring a guess. DSP-10
// gives a perfusion index only from 30 clean seconds (ง6.2), so a shorter practice leaves it open too.
export function practiceMeasures(capture: KeptCapture): {
  measures: RatingMeasures;
  summary: PracticeSummary;
} {
  const intervals = intervalsNs(capture);
  const spanNs = intervals.reduce((total, interval) => total + interval, 0);
  const achievedFps = intervals.length > 0 && spanNs > 0 ? (intervals.length * NS_PER_S) / spanNs : null;
  let frameIntervalSdMs: number | null = null;
  if (intervals.length > 1) {
    const mean = spanNs / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + (interval - mean) ** 2, 0) / intervals.length;
    frameIntervalSdMs = Math.sqrt(variance) / NS_PER_MS;
  }
  const perfusionIndexPct =
    capture.samples.length > 1
      ? analyzeReading(
          { samples: [...capture.samples], stats: [...capture.stats] },
          practiceContext(capture.captureFps),
        ).perfusionIndexPct
      : null;
  const snrDb = estimateLiveHeartRate([...capture.samples])?.snrDb ?? null;
  const coupling = perfusionIndexPct !== null && snrDb !== null ? { perfusionIndexPct, snrDb } : null;
  return {
    measures: { lensId: capture.lensId, achievedFps, frameIntervalSdMs, coupling },
    summary: { achievedFps, frameIntervalSdMs, perfusionIndexPct, snrDb },
  };
}
