// §7: the first 7 readings are "learning"; after that the band is the median plus or minus 1.5 IQR.
export const learningReadings = 7;

export type Band = { low: number; high: number };

// Linear interpolation between the two nearest ranks, so the quartiles of a short list are well defined.
function quantile(sortedValues: readonly number[], fraction: number): number {
  const position = (sortedValues.length - 1) * fraction;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  return sortedValues[below]! + (sortedValues[above]! - sortedValues[below]!) * (position - below);
}

function sorted(values: readonly number[]): number[] {
  return [...values].sort((first, second) => first - second);
}

export function median(values: readonly number[]): number | null {
  return values.length === 0 ? null : quantile(sorted(values), 0.5);
}

export function personalBand(values: readonly number[]): Band | null {
  if (values.length < learningReadings) return null;
  const ordered = sorted(values);
  const middle = quantile(ordered, 0.5);
  const spread = 1.5 * (quantile(ordered, 0.75) - quantile(ordered, 0.25));
  return { low: middle - spread, high: middle + spread };
}
