import type { StoredReading } from '@/home/readings';

import type { HistoryReading } from './series';

// The caffeine answer is not saved with a reading yet, so no point is marked: a guess would draw a cup the
// person never chose.
export function historyFromStored(readings: readonly StoredReading[]): HistoryReading[] {
  return readings.map(({ id, takenAt, mode, outcome }) => ({
    id,
    createdAt: new Date(takenAt),
    mode: mode ?? 'quick',
    hr: outcome.metrics.hr?.value ?? null,
    rmssd: outcome.metrics.rmssd?.value ?? null,
    resp: outcome.metrics.resp?.value ?? null,
    rhythm: outcome.metrics.rhythm?.class ?? null,
    caffeine: false,
  }));
}
