// Matches numpy.median: the mean of the two middle values for an even count. NaN for no values.
export function median(values: ArrayLike<number>): number {
  const sorted = Float64Array.from(values).sort();
  if (sorted.length === 0) return NaN;
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
