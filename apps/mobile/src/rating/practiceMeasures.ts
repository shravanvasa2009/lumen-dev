import {
  analyzeReading,
  DSP_CONFIG,
  estimateLiveHeartRate,
  type ReadingContext,
  type RatingMeasures,
  type Sample,
} from '@lumen/core';

import type { KeptCapture } from '@/measure/keptCapture';
import type { PracticeSummary } from '@/store/deviceRating';

const NS_PER_S = 1e9;
const NS_PER_MS = 1e6;

// The capture's own spans and SQI scores go in as analyzeKeptCapture passes them, so "clean" means here what it
// means in a real reading. The rating reads perfusion, never a verdict about the rhythm.
const practiceContext = (capture: KeptCapture): ReadingContext => ({
  captureFps: capture.captureFps,
  tier: null,
  mode: 'quick',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: capture.motionSpans,
  coldHandsSpans: capture.coldHandsSpans,
  sqi: capture.sqi,
  validationRhythmLabel: null,
});

function intervalsNs(capture: KeptCapture): number[] {
  return capture.samples.slice(1).map((sample, index) => sample.tNs - capture.samples[index]!.tNs);
}

// Spec §5.1: achieved fps and the SD of frame intervals come from the frames' own clock; the pulse's
// perfusion index (DSP-10) and spectral SNR (the live estimator's) come from the same frames. A pulse the
// estimator cannot find leaves coupling null, so the rating stays open instead of scoring a guess. DSP-10
// gives a perfusion index only from 30 clean seconds (section 6.2), so a shorter practice leaves it open too.
// The live estimator reads only the last windowS seconds, and the practice camera can keep running after the
// finger lifts (the user taps Continue and reads the next screen), so the tail alone can be flat. Each second of
// the capture is read as the end of a window and the median of the windows with a pulse is the coupling.
function pulseSnrDb(samples: readonly Sample[]): number | null {
  const last = samples[samples.length - 1];
  const first = samples[0];
  if (!last || !first) return null;
  const windowNs = DSP_CONFIG.liveHr.windowS * NS_PER_S;
  const snrs: number[] = [];
  let from = 0;
  for (let endNs = first.tNs + windowNs; endNs < last.tNs + NS_PER_S; endNs += NS_PER_S) {
    const cappedEndNs = Math.min(endNs, last.tNs);
    while (samples[from]!.tNs < cappedEndNs - windowNs) from += 1;
    let to = from;
    while (to < samples.length && samples[to]!.tNs <= cappedEndNs) to += 1;
    const found = estimateLiveHeartRate(samples.slice(from, to));
    if (found) snrs.push(found.snrDb);
  }
  if (snrs.length === 0) return null;
  const sorted = snrs.sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

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
      ? analyzeReading({ samples: [...capture.samples], stats: [...capture.stats] }, practiceContext(capture))
          .perfusionIndexPct
      : null;
  const snrDb = pulseSnrDb(capture.samples);
  const coupling = perfusionIndexPct !== null && snrDb !== null ? { perfusionIndexPct, snrDb } : null;
  return {
    measures: { lensId: capture.lensId, achievedFps, frameIntervalSdMs, coupling },
    summary: { achievedFps, frameIntervalSdMs, perfusionIndexPct, snrDb },
  };
}
