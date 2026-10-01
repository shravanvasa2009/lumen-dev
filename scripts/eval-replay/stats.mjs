// Statistics for eval:replay (spec §22). Every confidence interval resamples subjects, never readings
// or windows (§22.1: a window-level split leaks subject identity and narrows the interval falsely).

export const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function rmssd(intervalsMs) {
  const squares = intervalsMs.slice(1).map((value, i) => (value - intervalsMs[i]) ** 2);
  return Math.sqrt(mean(squares));
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

// rows: [{ subject, value }]. The point estimate is the mean over rows; the 95% CI comes from
// resampling whole subjects with replacement and taking the 2.5th and 97.5th percentiles.
export function subjectBootstrap(rows) {
  if (rows.length === 0) return { value: null, ci95: null };
  const bySubject = new Map();
  for (const row of rows) bySubject.set(row.subject, [...(bySubject.get(row.subject) ?? []), row.value]);
  const subjects = [...bySubject.values()];
  const random = mulberry32(BOOTSTRAP_SEED);
  const estimates = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i += 1) {
    const drawn = Array.from(
      { length: subjects.length },
      () => subjects[Math.floor(random() * subjects.length)],
    );
    estimates.push(mean(drawn.flat()));
  }
  estimates.sort((a, b) => a - b);
  return {
    value: mean(rows.map((row) => row.value)),
    ci95: [percentile(estimates, 0.025), percentile(estimates, 0.975)],
  };
}
