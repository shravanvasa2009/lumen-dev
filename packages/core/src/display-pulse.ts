import { DSP_CONFIG } from './config';
import { butterLowpass, filterZeroPhase } from './filters';

// Pearson correlation of the trace with itself `lag` samples later; null when too little overlaps.
function selfSimilarity(values: readonly number[], lag: number): number | null {
  const overlap = values.length - lag;
  if (lag < 1 || overlap < lag) return null;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < overlap; i++) {
    meanA += values[i]!;
    meanB += values[i + lag]!;
  }
  meanA /= overlap;
  meanB /= overlap;
  let cross = 0;
  let powerA = 0;
  let powerB = 0;
  for (let i = 0; i < overlap; i++) {
    const a = values[i]! - meanA;
    const b = values[i + lag]! - meanB;
    cross += a * b;
    powerA += a * a;
    powerB += b * b;
  }
  return powerA > 0 && powerB > 0 ? cross / Math.sqrt(powerA * powerB) : null;
}

// The beat rate to filter around. A rate locked on 2× repeats far better after two of its beats than after one.
function fundamentalHz(ppg: readonly number[], rateHz: number, rateBpm: number): number {
  const { halfRateMargin } = DSP_CONFIG.displayPulse;
  const fundamental = rateBpm / 60;
  if (rateBpm / 2 < DSP_CONFIG.liveHr.minBpm) return fundamental;
  const oneBeat = selfSimilarity(ppg, Math.round(rateHz / fundamental));
  const twoBeats = selfSimilarity(ppg, Math.round((2 * rateHz) / fundamental));
  if (oneBeat === null || twoBeats === null) return fundamental;
  return twoBeats - oneBeat > halfRateMargin ? fundamental / 2 : fundamental;
}

/** Display only: the live graph's pulse with one smooth bump per beat; never used for analysis. */
export function displayPulse(
  tS: readonly number[],
  ppg: readonly number[],
  rateBpm: number | null,
): number[] {
  const { order, cutoffPerFundamental, cutoffRangeHz, fallbackCutoffHz } = DSP_CONFIG.displayPulse;
  const unchanged = [...ppg];
  // filterZeroPhase pads with 3 × (2 × sections + 1) samples and needs more than that.
  const padLength = 3 * (2 * Math.ceil(order / 2) + 1);
  if (ppg.length !== tS.length || ppg.length <= padLength || !ppg.every(Number.isFinite)) return unchanged;
  const spanS = tS[tS.length - 1]! - tS[0]!;
  const rateHz = (ppg.length - 1) / spanS;
  if (!(rateHz > 0) || !Number.isFinite(rateHz)) return unchanged;

  const [lowHz, highHz] = cutoffRangeHz as [number, number];
  const cutoffHz =
    rateBpm !== null && Number.isFinite(rateBpm) && rateBpm > 0
      ? Math.min(highHz, Math.max(lowHz, cutoffPerFundamental * fundamentalHz(ppg, rateHz, rateBpm)))
      : fallbackCutoffHz;
  // Below Nyquist with room; a 3 Hz cutoff on a 24 fps capture is well inside.
  if (cutoffHz >= rateHz / 2) return unchanged;
  return Array.from(filterZeroPhase(butterLowpass(order, cutoffHz, rateHz), ppg));
}
