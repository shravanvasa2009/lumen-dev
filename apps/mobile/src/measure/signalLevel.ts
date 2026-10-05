import { couplingFactor, estimateLiveHeartRate, type Sample } from '@lumen/core';

// The practice meter's 0 to 1 position: core's coupling factor (spec 05 section 5.1) of the session's live
// perfusion index and the pulse's SNR, read as the live feed spec 04 section 4.2 technique 4 asks for (ADR 0095).
// The caller passes the covered frames of the last liveHr.windowS seconds, and only once they span the estimator's
// liveHr.minSegmentS (ADR 0027). The estimator returns null below its own 6 dB limit, so the SNR factor falls from
// 0.5 to 0 there; the bar is a coarse guide, not a smooth SNR readout. A missing perfusion index is 0 and a missing
// SNR is null, so the level is never NaN.
export function signalLevel(perfusionPct: number | null, frames: readonly Sample[]): number | null {
  if (perfusionPct === null) return null;
  const level = couplingFactor(
    Number.isFinite(perfusionPct) ? perfusionPct : 0,
    estimateLiveHeartRate([...frames])?.snrDb ?? null,
  );
  return Number.isFinite(level) ? level : 0;
}
