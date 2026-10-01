import { mean } from './stats.mjs';

// §22.1: the strap's Bluetooth timestamps arrive with variable delay, so phone and Polar intervals are
// matched by sequence: slide one over the other by up to ±10 beats, keep the lag whose overlapping
// intervals correlate best, then compare beat by beat.
const MAX_LAG_BEATS = 10;
// Fewer overlapping beats than this can't support a correlation, so the reading is left unaligned.
const MIN_OVERLAP_BEATS = 8;

function pearson(a, b) {
  const meanA = mean(a);
  const meanB = mean(b);
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < a.length; i += 1) {
    covariance += (a[i] - meanA) * (b[i] - meanB);
    varianceA += (a[i] - meanA) ** 2;
    varianceB += (b[i] - meanB) ** 2;
  }
  return varianceA === 0 || varianceB === 0 ? 0 : covariance / Math.sqrt(varianceA * varianceB);
}

function overlap(phone, polar, lag) {
  // A positive lag means phone[i] lines up with polar[i + lag].
  const start = Math.max(0, -lag);
  const end = Math.min(phone.length, polar.length - lag);
  return {
    phone: phone.slice(start, Math.max(start, end)),
    polar: polar.slice(start + lag, Math.max(start + lag, end + lag)),
  };
}

export function alignIntervals(phoneMs, polarMs) {
  let best = null;
  for (let lag = -MAX_LAG_BEATS; lag <= MAX_LAG_BEATS; lag += 1) {
    const pair = overlap(phoneMs, polarMs, lag);
    if (pair.phone.length < MIN_OVERLAP_BEATS) continue;
    const correlation = pearson(pair.phone, pair.polar);
    if (best === null || correlation > best.correlation) best = { lag, correlation, ...pair };
  }
  return best;
}
