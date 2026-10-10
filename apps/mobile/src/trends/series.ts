import type { QualityReason, RhythmClass } from '@lumen/core';

import type { MeasureMode } from '@/measure/mode';

import { personalBand, median, type Band } from './baseline';

// One saved reading, reduced to what Trends plots. Experimental measurements are not in this shape on
// purpose: they are trended in Lab mode only (§12.5).
export type HistoryReading = {
  id: string;
  createdAt: Date;
  mode: MeasureMode;
  hr: number | null;
  rmssd: number | null;
  resp: number | null;
  rhythm: RhythmClass | null;
  // Values tagged lower quality (ADR 0104 addendum, 2026-10-10): every saved reading shows, so these are drawn
  // hollow and tagged, and stay out of the median, band, and baseline count.
  lowerQuality: { hr: number | null; rmssd: number | null; resp: number | null };
  // Why the reading is lower quality, for the tag's sheet; [] when it is not.
  lowerReasons: readonly QualityReason[];
  // A flagged rhythm from a lower-quality reading (ADR 0104): kept apart from `rhythm` so it is always drawn
  // with its marker, and never feeds a median or band.
  flaggedLowRhythm: RhythmClass | null;
  // The caffeine answer of the context check (§7).
  caffeine: boolean;
  // Accepted beat-to-beat intervals for the rhythm map tiles; [] when the reading kept none.
  intervalsMs: readonly number[];
};

export const trendMetrics = ['hr', 'hrv', 'resp'] as const;
export type TrendMetric = (typeof trendMetrics)[number];

const ranges = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type TrendRange = keyof typeof ranges;

export type TrendPoint = {
  id: string;
  createdAt: Date;
  value: number;
  caffeine: boolean;
  rhythm: RhythmClass | null;
  reasons: readonly QualityReason[];
};

type FlaggedLowRhythm = { id: string; createdAt: Date; rhythm: RhythmClass };

export type TrendSeries = {
  points: readonly TrendPoint[];
  // Lower-quality values in the range: drawn hollow and listed with a tag, outside the median, band, and
  // baseline count (ADR 0104 addendum).
  lowerPoints: readonly TrendPoint[];
  // Lower-quality flagged rhythms in the range, whether or not the reading has a value for this metric: Trends
  // must not hide a flag the other surfaces show.
  flaggedLowRhythms: readonly FlaggedLowRhythm[];
  // Median of the points in the range.
  median: number | null;
  // §7: from every reading of this metric, whatever the range; null while still learning.
  band: Band | null;
  // How many readings of this metric exist in all, for the "learning" count.
  baselineCount: number;
};

const dayMs = 24 * 60 * 60 * 1000;

function valueOf(reading: HistoryReading, metric: TrendMetric): number | null {
  return { hr: reading.hr, hrv: reading.rmssd, resp: reading.resp }[metric];
}

function lowerValueOf(reading: HistoryReading, metric: TrendMetric): number | null {
  const { hr, rmssd, resp } = reading.lowerQuality;
  return { hr, hrv: rmssd, resp }[metric];
}

// The chart and median use the readings inside the range. The personal band and the learning count use
// the user's whole history of the metric, because §7 ties the baseline to the first 7 readings, not to
// the range button.
export function trendSeries(
  readings: readonly HistoryReading[],
  metric: TrendMetric,
  range: TrendRange,
  now: Date,
): TrendSeries {
  const since = now.getTime() - ranges[range] * dayMs;
  const everyValue = readings.flatMap((reading) => {
    const value = valueOf(reading, metric);
    return value === null ? [] : [value];
  });
  const inRange = (valueFor: (reading: HistoryReading, metric: TrendMetric) => number | null) =>
    readings
      .flatMap((reading) => {
        const value = valueFor(reading, metric);
        const when = reading.createdAt.getTime();
        if (value === null || when < since || when > now.getTime()) return [];
        const { id, createdAt, caffeine, rhythm, lowerReasons } = reading;
        return [{ id, createdAt, value, caffeine, rhythm, reasons: lowerReasons }];
      })
      .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  const points = inRange(valueOf);
  const flaggedLowRhythms = readings.flatMap(({ id, createdAt, flaggedLowRhythm }) =>
    flaggedLowRhythm !== null && createdAt.getTime() >= since && createdAt.getTime() <= now.getTime()
      ? [{ id, createdAt, rhythm: flaggedLowRhythm }]
      : [],
  );
  return {
    points,
    lowerPoints: inRange(lowerValueOf),
    flaggedLowRhythms,
    median: median(points.map((point) => point.value)),
    band: personalBand(everyValue),
    baselineCount: everyValue.length,
  };
}

const steps = [1, 2, 5, 10, 20, 50, 100];

// Round gridlines at the smallest step that fits the data and band in four intervals.
export function chartAxis(values: readonly number[]): { low: number; high: number; step: number } {
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const step =
    steps.find((candidate) => Math.ceil(highest / candidate) - Math.floor(lowest / candidate) <= 4) ??
    steps[steps.length - 1]!;
  const low = Math.floor(lowest / step) * step;
  const high = Math.max(Math.ceil(highest / step) * step, low + step);
  return { low, high, step };
}
