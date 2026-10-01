import { mean } from './stats.mjs';

// §22.1: the strap's Bluetooth timestamps arrive with variable delay, so phone and Polar intervals are
// matched by sequence. Slide the full sequences (rejected beats included, so no gap shifts the pairing)
// over ±10 beats and keep the lag whose overlap correlates best (ADR 0037).
const MAX_LAG_BEATS = 10;
// A short overlap at an extreme lag can correlate by chance, so it must cover most of the shorter sequence.
const MIN_OVERLAP_BEATS = 8;
const MIN_OVERLAP_FRACTION = 0.6;
const MIN_CORRELATION = 0.5;

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

// Returns { lag, correlation, pairs: [[phoneIndex, polarIndex], ...] }, or null when nothing aligns well
// enough. A positive lag means phone[i] lines up with polar[i + lag]. Pairs cover every overlapping
// position; the correlation uses only pairs where both beats are usable, because one wild rejected beat
// would otherwise swamp it.
export function alignIntervals(phoneMs, polarMs, isUsablePair = () => true) {
  const minOverlap = Math.max(
    MIN_OVERLAP_BEATS,
    Math.ceil(MIN_OVERLAP_FRACTION * Math.min(phoneMs.length, polarMs.length)),
  );
  let best = null;
  for (let lag = -MAX_LAG_BEATS; lag <= MAX_LAG_BEATS; lag += 1) {
    const start = Math.max(0, -lag);
    const end = Math.min(phoneMs.length, polarMs.length - lag);
    const pairs = Array.from({ length: Math.max(0, end - start) }, (_, i) => [start + i, start + i + lag]);
    const usable = pairs.filter(([p, q]) => isUsablePair(p, q));
    if (usable.length < minOverlap) continue;
    const correlation = pearson(
      usable.map(([p]) => phoneMs[p]),
      usable.map(([, q]) => polarMs[q]),
    );
    if (best === null || correlation > best.correlation) best = { lag, correlation, pairs };
  }
  return best && best.correlation >= MIN_CORRELATION ? best : null;
}
