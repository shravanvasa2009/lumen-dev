import type { FrameStat, Sample } from './capture';
import { DSP_CONFIG } from './config';
import type { RejectionReason } from './live-session';

// Shared by analyzeReading and LiveSession, so the live clean-seconds counter and the final analysis
// reject the same frames.

// Appendix A gives channel means on 0..1; anything else (NaN, ±Infinity, a 0–255 value) is a broken frame.
// Its signal is left out as if the frame were dropped, so DSP-2's gap rule decides what happens around it.
export function validChannels(sample: Sample): boolean {
  return [sample.r, sample.g, sample.b].every((channel) => channel >= 0 && channel <= 1);
}

/**
 * DSP-4 per frame: null when covered; "clipping" when only the clip limit fails; else "coverage". A broken
 * frame or a non-finite stat is "coverage": +Infinity red would otherwise pass the ratio test.
 */
export function frameProblem(sample: Sample, stat: FrameStat): RejectionReason | null {
  const { minRedRatio, minRedMean, maxSpatialStdR, maxClipFrac } = DSP_CONFIG.dsp4;
  const covered =
    validChannels(sample) &&
    [stat.spatialStdR, stat.clipFrac].every(Number.isFinite) &&
    sample.r >= minRedRatio * (sample.g + sample.b) &&
    sample.r >= minRedMean &&
    stat.spatialStdR <= maxSpatialStdR;
  if (!covered) return 'coverage';
  return stat.clipFrac > maxClipFrac ? 'clipping' : null;
}
