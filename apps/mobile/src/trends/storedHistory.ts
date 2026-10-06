import type { StoredReading } from '@/home/readings';
import { isLowQuality } from '@/results/quality';

import type { HistoryReading } from './series';

// Only standard values (ADR 0104): a lower-quality one would move the trend median and the personal band with no
// tag beside it, so it is left out as a missed floor is. A flagged
// lower-quality rhythm is the exception: it is carried apart, to be drawn with its marker.
const standard = <T extends object>(metric: T | null): T | null =>
  metric && !isLowQuality(metric) ? metric : null;

// The caffeine answer is not saved with a reading yet, so no point is marked: a guess would draw a cup the
// person never chose.
export function historyFromStored(readings: readonly StoredReading[]): HistoryReading[] {
  return readings.map(({ id, takenAt, mode, outcome }) => ({
    id,
    createdAt: new Date(takenAt),
    mode: mode ?? 'quick',
    hr: standard(outcome.metrics.hr)?.value ?? null,
    rmssd: standard(outcome.metrics.rmssd)?.value ?? null,
    resp: standard(outcome.metrics.resp)?.value ?? null,
    rhythm: standard(outcome.metrics.rhythm)?.class ?? null,
    flaggedLowRhythm:
      outcome.metrics.rhythm && isLowQuality(outcome.metrics.rhythm) && outcome.metrics.rhythm.flag !== null
        ? outcome.metrics.rhythm.class
        : null,
    caffeine: false,
  }));
}
