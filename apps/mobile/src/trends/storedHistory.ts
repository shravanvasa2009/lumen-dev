import type { StoredReading } from '@/home/readings';
import { isLowQuality } from '@/results/quality';

import type { HistoryReading } from './series';

// ADR 0104: only standard values feed the trend median and the personal band, since a lower-quality one would
// move them with no tag beside it. A lower-quality value is not dropped, though: it is carried apart in
// `lowerQuality`, to be drawn marked, so every saved reading shows in Trends.
const standard = <T extends object>(metric: T | null): T | null =>
  metric && !isLowQuality(metric) ? metric : null;
const lower = <T extends object>(metric: T | null): T | null =>
  metric && isLowQuality(metric) ? metric : null;

// The caffeine answer is not saved with a reading yet, so no point is marked: a guess would draw a cup the
// person never chose.
export function historyFromStored(readings: readonly StoredReading[]): HistoryReading[] {
  return readings.map(({ id, takenAt, mode, outcome, intervalsMs }) => ({
    id,
    createdAt: new Date(takenAt),
    mode: mode ?? 'quick',
    hr: standard(outcome.metrics.hr)?.value ?? null,
    rmssd: standard(outcome.metrics.rmssd)?.value ?? null,
    resp: standard(outcome.metrics.resp)?.value ?? null,
    lowerQuality: {
      hr: lower(outcome.metrics.hr)?.value ?? null,
      rmssd: lower(outcome.metrics.rmssd)?.value ?? null,
      resp: lower(outcome.metrics.resp)?.value ?? null,
    },
    rhythm: standard(outcome.metrics.rhythm)?.class ?? null,
    flaggedLowRhythm:
      outcome.metrics.rhythm && isLowQuality(outcome.metrics.rhythm) && outcome.metrics.rhythm.flag !== null
        ? outcome.metrics.rhythm.class
        : null,
    caffeine: false,
    intervalsMs: intervalsMs ?? [],
  }));
}
