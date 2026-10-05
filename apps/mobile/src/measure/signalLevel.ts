import { couplingFactor, DSP_CONFIG, estimateLiveHeartRate, type Sample } from '@lumen/core';

const NS_PER_S = 1e9;

// The practice meter's 0 to 1 position: core's coupling factor (spec 05 section 5.1) of the session's live
// perfusion index, read as the live feed spec 04 section 4.2 technique 4 asks for (ADR 0095). The pulse's SNR
// needs liveHr.minSegmentS of frames (ADR 0027); until then the perfusion index alone moves the bar, which is
// the coupling factor with the SNR at its full-score value. After that, the estimator returns null below its own
// 6 dB limit, so the SNR factor falls from 0.5 to 0 there; the bar is a coarse guide, not a smooth SNR readout.
// A missing perfusion index or SNR is 0 and null, so the level is never NaN.
export function signalLevel(
  perfusionPct: number | null,
  frames: readonly Sample[],
  newestNs: number,
): number | null {
  if (perfusionPct === null) return null;
  const firstNs = frames[0]?.tNs;
  const spanS = firstNs === undefined ? 0 : (newestNs - firstNs) / NS_PER_S;
  const snrDb =
    spanS < DSP_CONFIG.liveHr.minSegmentS
      ? DSP_CONFIG.rating.couplingFullSnrDb
      : (estimateLiveHeartRate([...frames])?.snrDb ?? null);
  const level = couplingFactor(Number.isFinite(perfusionPct) ? perfusionPct : 0, snrDb);
  return Number.isFinite(level) ? level : 0;
}
