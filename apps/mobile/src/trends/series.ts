import type { RhythmClass } from '@lumen/core';

import type { EvidenceMetric } from '@/evidence';
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
  // The caffeine answer of the context check (§7).
  caffeine: boolean;
};

export const trendMetrics = ['hr', 'hrv', 'resp'] as const;
export type TrendMetric = (typeof trendMetrics)[number];

// The metric's card in the evidence file.
export const evidenceOf: Record<TrendMetric, EvidenceMetric> = { hr: 'hr', hrv: 'hrv', resp: 'resp' };

const ranges = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type TrendRange = keyof typeof ranges;

export type TrendPoint = {
  id: string;
  createdAt: Date;
  value: number;
  caffeine: boolean;
  rhythm: RhythmClass | null;
};

export type TrendSeries = {
  points: readonly TrendPoint[];
  median: number | null;
  band: Band | null;
};

const dayMs = 24 * 60 * 60 * 1000;

function valueOf(reading: HistoryReading, metric: TrendMetric): number | null {
  return { hr: reading.hr, hrv: reading.rmssd, resp: reading.resp }[metric];
}

// Median and band come from the points inside the range, never from numbers kept elsewhere.
export function trendSeries(
  readings: readonly HistoryReading[],
  metric: TrendMetric,
  range: TrendRange,
  now: Date,
): TrendSeries {
  const since = now.getTime() - ranges[range] * dayMs;
  const points = readings
    .flatMap((reading) => {
      const value = valueOf(reading, metric);
      const when = reading.createdAt.getTime();
      if (value === null || when < since || when > now.getTime()) return [];
      const { id, createdAt, caffeine, rhythm } = reading;
      return [{ id, createdAt, value, caffeine, rhythm }];
    })
    .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  const values = points.map((point) => point.value);
  return { points, median: median(values), band: personalBand(values) };
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
