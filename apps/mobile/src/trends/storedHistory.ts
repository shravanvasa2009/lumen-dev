import type { StoredReading } from '@/home/readings';
import { isLowQuality, metricReasons, readingQuality } from '@/results/quality';

import type { HistoryReading } from './series';

// ADR 0104 addendum (owner, 2026-10-10): every saved reading shows in Trends. Only standard values feed the
// median, personal band, and baseline count; a lower-quality value is carried apart in `lowerQuality`, to be
// drawn hollow and tagged.
const standard = <T extends object>(metric: T | null): T | null =>
  metric && !isLowQuality(metric) ? metric : null;
const lower = <T extends object>(metric: T | null): T | null =>
  metric && isLowQuality(metric) ? metric : null;

// The caffeine answer is not saved with a reading yet, so no point is marked: a guess would draw a cup the
// person never chose.
export function historyFromStored(readings: readonly StoredReading[]): HistoryReading[] {
  return readings.map(({ id, takenAt, mode, outcome, intervalsMs }) => {
    const quality = readingQuality(outcome);
    return {
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
      lowerReasons: {
        hr: metricReasons(outcome.metrics.hr, quality) ?? [],
        rmssd: metricReasons(outcome.metrics.rmssd, quality) ?? [],
        resp: metricReasons(outcome.metrics.resp, quality) ?? [],
      },
      rhythm: standard(outcome.metrics.rhythm)?.class ?? null,
      flaggedLowRhythm:
        outcome.metrics.rhythm && isLowQuality(outcome.metrics.rhythm) && outcome.metrics.rhythm.flag !== null
          ? outcome.metrics.rhythm.class
          : null,
      caffeine: false,
      intervalsMs: intervalsMs ?? [],
    };
  });
}
