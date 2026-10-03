import type { FrameStat, Sample } from './capture';
import { DSP_CONFIG } from './config';
import type { RejectionReason } from './live-session';

// Shared by analyzeReading and LiveSession, so the live clean-seconds counter and the final analysis
// reject the same frames.

// DSP-4 per frame: null when covered; "clipping" when only the clip limit fails; else "coverage".
// A frame with any non-finite value is "coverage": +Infinity red would otherwise pass the ratio test.
export function frameProblem(sample: Sample, stat: FrameStat): RejectionReason | null {
  const { minRedRatio, minRedMean, maxSpatialStdR, maxClipFrac } = DSP_CONFIG.dsp4;
  const covered =
    [sample.r, sample.g, sample.b, stat.spatialStdR, stat.clipFrac].every(Number.isFinite) &&
    sample.r >= minRedRatio * (sample.g + sample.b) &&
    sample.r >= minRedMean &&
    stat.spatialStdR <= maxSpatialStdR;
  if (!covered) return 'coverage';
  return stat.clipFrac > maxClipFrac ? 'clipping' : null;
}
