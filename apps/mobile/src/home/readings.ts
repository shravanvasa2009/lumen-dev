import type { ReadingResult } from '@lumen/core';

export type StoredReading = { takenAt: number; outcome: ReadingResult };

export type TileMetric = 'hr' | 'rmssd' | 'resp';

const SPARKLINE_POINTS = 7;

export function latestReading(readings: readonly StoredReading[]): StoredReading | null {
  return readings.reduce<StoredReading | null>(
    (newest, reading) => (newest === null || reading.takenAt > newest.takenAt ? reading : newest),
    null,
  );
}

// Oldest first, so the sparkline reads left to right. A reading whose card missed its clean-data floor
// has a null metric and is left out of the line.
export function tileSeries(readings: readonly StoredReading[], metric: TileMetric): number[] {
  return [...readings]
    .sort((first, second) => first.takenAt - second.takenAt)
    .flatMap((reading) => reading.outcome.metrics[metric]?.value ?? [])
    .slice(-SPARKLINE_POINTS);
}
