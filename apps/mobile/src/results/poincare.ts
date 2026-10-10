function populationSd(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export type RhythmMapShape = {
  // Centre of the cloud in ms: the mean of the intervals.
  centerMs: number;
  // Spread across the diagonal (SD1: beat-to-beat change) and along it (SD2: slower drift), in ms.
  sd1Ms: number;
  sd2Ms: number;
  pairs: number;
};

// Same definitions as the rhythm features in @lumen/core: SD1 from the successive differences, SD2 from the
// successive sums, each over root two. Null below three intervals, where a spread means nothing.
export function rhythmMapShape(intervalsMs: readonly number[]): RhythmMapShape | null {
  if (intervalsMs.length < 3) return null;
  const pairs = intervalsMs.slice(1).map((next, index) => [intervalsMs[index] ?? next, next] as const);
  return {
    centerMs: intervalsMs.reduce((sum, value) => sum + value, 0) / intervalsMs.length,
    sd1Ms: populationSd(pairs.map(([first, next]) => (next - first) / Math.SQRT2)),
    sd2Ms: populationSd(pairs.map(([first, next]) => (next + first) / Math.SQRT2)),
    pairs: pairs.length,
  };
}

// The gap that sits in the middle of the sorted intervals, which one stray beat cannot move.
export function medianIntervalMs(intervalsMs: readonly number[]): number | null {
  if (intervalsMs.length === 0) return null;
  const sorted = [...intervalsMs].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
