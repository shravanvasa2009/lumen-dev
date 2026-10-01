import { mean } from './stats.mjs';

// §22.1: the strap's Bluetooth timestamps arrive with variable delay, so phone and strap beats are matched
// by sequence, in two steps:
// 1. Coarse: slide the interval sequences over ±10 beats and keep the lag whose usable pairs correlate best.
// 2. Fine: turn both sequences into beat times (running sums of intervals) and pair beats by time. A missed
//    or extra phone beat merges or splits an interval but keeps the elapsed time, so beats after it still
//    line up, where a single positional lag would be off by one from that point on.
const MAX_LAG_BEATS = 10;
// A short overlap at an extreme lag can correlate by chance, so it must cover most of the shorter sequence.
const MIN_OVERLAP_BEATS = 8;
const MIN_OVERLAP_FRACTION = 0.6;
const MIN_CORRELATION = 0.5;
// Two beats are the same heartbeat when their times agree this closely (well under one interval).
const BEAT_MATCH_MS = 100;

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

function coarseLag(phoneMs, polarMs, isUsablePair) {
  const minOverlap = Math.max(
    MIN_OVERLAP_BEATS,
    Math.ceil(MIN_OVERLAP_FRACTION * Math.min(phoneMs.length, polarMs.length)),
  );
  let best = null;
  for (let lag = -MAX_LAG_BEATS; lag <= MAX_LAG_BEATS; lag += 1) {
    const start = Math.max(0, -lag);
    const end = Math.min(phoneMs.length, polarMs.length - lag);
    const usable = Array.from({ length: Math.max(0, end - start) }, (_, i) => [
      start + i,
      start + i + lag,
    ]).filter(([p, q]) => isUsablePair(p, q));
    if (usable.length < minOverlap) continue;
    const correlation = pearson(
      usable.map(([p]) => phoneMs[p]),
      usable.map(([, q]) => polarMs[q]),
    );
    if (best === null || correlation > best.correlation) best = { lag, correlation, usable };
  }
  return best && best.correlation >= MIN_CORRELATION ? best : null;
}

// Beat k starts interval k; the last entry is the end of the last interval.
const beatTimes = (intervalsMs) =>
  intervalsMs.reduce((times, value) => [...times, times.at(-1) + value], [0]);

function nearestBeat(times, target) {
  let low = 0;
  let high = times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] < target) low = middle;
    else high = middle;
  }
  const index = Math.abs(times[low] - target) <= Math.abs(times[high] - target) ? low : high;
  return Math.abs(times[index] - target) <= BEAT_MATCH_MS ? index : null;
}

// Returns { lag, correlation, pairs: [[phoneIndex, polarIndex], ...] } or null when nothing aligns well
// enough. A pair means phone interval p starts and ends on the same heartbeats as strap interval q.
export function alignIntervals(phoneMs, polarMs, isUsablePair = () => true) {
  const coarse = coarseLag(phoneMs, polarMs, isUsablePair);
  if (!coarse) return null;
  const phoneBeats = beatTimes(phoneMs);
  const polarBeats = beatTimes(polarMs);
  // Anchor on the time offset (from the coarse pairs) that lines up the most beats; any single pair could
  // sit just after a count error.
  let offset = 0;
  let mostMatched = -1;
  for (const [p, q] of coarse.usable) {
    const candidate = polarBeats[q] - phoneBeats[p];
    const matched = phoneBeats.filter((time) => nearestBeat(polarBeats, time + candidate) !== null).length;
    if (matched > mostMatched) [offset, mostMatched] = [candidate, matched];
  }
  const pairs = [];
  for (let p = 0; p < phoneMs.length; p += 1) {
    const start = nearestBeat(polarBeats, phoneBeats[p] + offset);
    const end = nearestBeat(polarBeats, phoneBeats[p + 1] + offset);
    if (start !== null && end === start + 1) pairs.push([p, start]);
  }
  // With a very regular rhythm, beat times also line up one whole beat off; the paired intervals then no
  // longer track each other, so the pairing itself must still correlate.
  const usable = pairs.filter(([p, q]) => isUsablePair(p, q));
  const correlation = pearson(
    usable.map(([p]) => phoneMs[p]),
    usable.map(([, q]) => polarMs[q]),
  );
  if (usable.length < MIN_OVERLAP_BEATS || correlation < MIN_CORRELATION) return null;
  return { lag: coarse.lag, correlation, pairs };
}
