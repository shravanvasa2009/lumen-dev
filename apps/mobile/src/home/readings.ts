import type { ReadingResult } from '@lumen/core';

import type { MeasureMode } from '@/measure/mode';

// mode is the check that took the reading. A reading without one counts as a Quick Check, so it can never
// clear the widget's doctor status (spec §9.6, ADR 0005). intervalsMs are the accepted beat-to-beat intervals
// the rhythm charts draw; the store gives [] for a reading saved before they were kept.
export type StoredReading = {
  id: string;
  takenAt: number;
  outcome: ReadingResult;
  mode?: MeasureMode;
  intervalsMs?: readonly number[];
};

export function latestReading(readings: readonly StoredReading[]): StoredReading | null {
  return readings.reduce<StoredReading | null>(
    (newest, reading) => (newest === null || reading.takenAt > newest.takenAt ? reading : newest),
    null,
  );
}
