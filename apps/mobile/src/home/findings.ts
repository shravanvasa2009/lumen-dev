import type { DiabetesMetric, RhythmMetric, RmssdMetric } from '@lumen/core';

import { isLowQuality } from '@/results/quality';

import type { StoredReading } from './readings';

// Two Full Scans on different days are needed before the diabetes pattern can be flagged (spec 11.4).
export const DIABETES_DAYS_NEEDED = 2;

type Found<Metric> = { reading: StoredReading; metric: Metric };

function newestFirst(readings: readonly StoredReading[]): StoredReading[] {
  return [...readings].sort((first, second) => second.takenAt - first.takenAt);
}

function newestWith<Metric>(
  readings: readonly StoredReading[],
  pick: (reading: StoredReading) => Metric | null,
): Found<Metric> | null {
  for (const reading of newestFirst(readings)) {
    const metric = pick(reading);
    if (metric !== null) return { reading, metric };
  }
  return null;
}

export function latestRhythm(readings: readonly StoredReading[]): Found<RhythmMetric> | null {
  return newestWith(readings, (reading) => reading.outcome.metrics.rhythm);
}

export function latestRmssd(readings: readonly StoredReading[]): Found<RmssdMetric> | null {
  return newestWith(readings, (reading) => reading.outcome.metrics.rmssd);
}

type DiabetesProgress = { days: number; latest: Found<DiabetesMetric> | null };

// Days are counted on the phone's calendar, from the readings whose diabetes value is standard: a lower-quality
// one is left out of the mean (ADR 0104), so it must not count toward "N of M readings so far" either.
export function diabetesProgress(readings: readonly StoredReading[]): DiabetesProgress {
  const days = new Set<string>();
  for (const reading of readings)
    if (reading.outcome.metrics.diabetes && !isLowQuality(reading.outcome.metrics.diabetes))
      days.add(new Date(reading.takenAt).toDateString());
  return { days: days.size, latest: newestWith(readings, (reading) => reading.outcome.metrics.diabetes) };
}
