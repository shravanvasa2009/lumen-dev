// Statistics for eval:replay (spec §22). Every subject counts equally: a metric is the
// mean of per-subject means, and its 95% CI resamples whole subjects, never readings or windows (§22.1).

export const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// RMSSD from successive differences where both neighbours are usable; null when none are.
export function rmssd(intervalsMs, usable = intervalsMs.map(() => true)) {
  const squares = [];
  for (let i = 1; i < intervalsMs.length; i += 1)
    if (usable[i] && usable[i - 1]) squares.push((intervalsMs[i] - intervalsMs[i - 1]) ** 2);
  return squares.length ? Math.sqrt(mean(squares)) : null;
}

// Seeded so the second agent's recompute (VER-1) and every rerun give the same interval.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOTSTRAP_ITERATIONS = 2000;
const BOOTSTRAP_SEED = 20261026;

function percentile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

// rows: [{ subject, value }]. One subject gives a value but no interval: there is nothing to resample.
export function subjectBootstrap(rows) {
  if (rows.length === 0) return { value: null, ci95: null };
  const bySubject = new Map();
  for (const row of rows) bySubject.set(row.subject, [...(bySubject.get(row.subject) ?? []), row.value]);
  // Subjects in code order, so the seeded draws give the same CI whatever order the folders were read in.
  const subjectMeans = [...bySubject.keys()].sort().map((subject) => mean(bySubject.get(subject)));
  if (subjectMeans.length < 2) return { value: subjectMeans[0], ci95: null };
  const random = mulberry32(BOOTSTRAP_SEED);
  const estimates = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i += 1)
    estimates.push(
      mean(
        Array.from(
          { length: subjectMeans.length },
          () => subjectMeans[Math.floor(random() * subjectMeans.length)],
        ),
      ),
    );
  estimates.sort((a, b) => a - b);
  return { value: mean(subjectMeans), ci95: [percentile(estimates, 0.025), percentile(estimates, 0.975)] };
}
