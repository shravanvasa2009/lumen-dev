import type { ReadingResult } from '@lumen/core';

import type { MeasureMode } from '@/measure/mode';
import { isLowQuality } from '@/results/quality';

// mode is the check that took the reading. A reading without one counts as a Quick Check, so it can never
// clear the widget's doctor status (spec §9.6, ADR 0005).
export type StoredReading = { id: string; takenAt: number; outcome: ReadingResult; mode?: MeasureMode };

export type TileMetric = 'hr' | 'rmssd' | 'resp';

const SPARKLINE_POINTS = 7;

export function latestReading(readings: readonly StoredReading[]): StoredReading | null {
  return readings.reduce<StoredReading | null>(
    (newest, reading) => (newest === null || reading.takenAt > newest.takenAt ? reading : newest),
    null,
  );
}

// Oldest first, so the sparkline reads left to right. A reading whose card missed its clean-data floor
// has a null metric and is left out of the line, and so is a lower-quality value (ADR 0104): a tile has no room
// for its tag.
export function tileSeries(readings: readonly StoredReading[], metric: TileMetric): number[] {
  return [...readings]
    .sort((first, second) => first.takenAt - second.takenAt)
    .flatMap((reading) => {
      const value = reading.outcome.metrics[metric];
      return value && !isLowQuality(value) ? [value.value] : [];
    })
    .slice(-SPARKLINE_POINTS);
}
