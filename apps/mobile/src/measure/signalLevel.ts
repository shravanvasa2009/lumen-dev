import { DSP_CONFIG, estimateLiveHeartRate, type Sample } from '@lumen/core';

const { couplingFullPiPct, couplingFullSnrDb } = DSP_CONFIG.rating;
const NS_PER_S = 1e9;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

// The session's live perfusion index (live.ts: 100 x (max - min of the filtered pulse) / mean red) over the
// same perfusionWindowS, from the waveform the session already filtered and the raw frames. Null until the
// window holds a pulse and a red level to divide by.
export function livePerfusionPct(
  waveform: { tS: readonly number[]; ppg: readonly number[] },
  frames: readonly Pick<Sample, 'tNs' | 'r'>[],
): number | null {
  const lastS = waveform.tS[waveform.tS.length - 1];
  const lastNs = frames[frames.length - 1]?.tNs;
  if (lastS === undefined || lastNs === undefined) return null;
  const { perfusionWindowS } = DSP_CONFIG.live;
  const pulse = waveform.ppg.filter((_, index) => lastS - waveform.tS[index]! <= perfusionWindowS);
  const reds = frames.filter((frame) => (lastNs - frame.tNs) / NS_PER_S <= perfusionWindowS);
  const meanRed = reds.reduce((total, frame) => total + frame.r, 0) / reds.length;
  if (pulse.length < 2 || !(meanRed > 0)) return null;
  return (100 * (Math.max(...pulse) - Math.min(...pulse))) / meanRed;
}

// The practice meter's 0 to 1 position: the coupling factors of spec 05 section 5.1 (PI over 1.0 % and SNR over
// 12 dB, each capped at 1), read as the live feed spec 04 section 4.2 technique 4 asks for (ADR 0095).
// The pulse's SNR needs liveHr.minSegmentS of frames (ADR 0027); until then the perfusion index alone moves the
// bar. After that, the estimator returns null below its own 6 dB limit, so the SNR factor falls from 0.5 to 0
// there; the bar is a coarse guide, not a smooth SNR readout.
export function signalLevel(
  perfusionPct: number | null,
  frames: readonly Sample[],
  newestNs: number,
): number | null {
  if (perfusionPct === null) return null;
  const perfusionFactor = clampUnit(perfusionPct / couplingFullPiPct);
  const firstNs = frames[0]?.tNs;
  const spanS = firstNs === undefined ? 0 : (newestNs - firstNs) / NS_PER_S;
  if (spanS < DSP_CONFIG.liveHr.minSegmentS) return perfusionFactor;
  const pulse = estimateLiveHeartRate([...frames]);
  return perfusionFactor * clampUnit((pulse?.snrDb ?? 0) / couplingFullSnrDb);
}
