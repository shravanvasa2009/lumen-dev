import { isRecord, metricRecord, readEvidence, evidenceMetrics, type EvidenceMetric } from '@/evidence';

import bundledEvidence from '../../assets/evidence.json';

export type AccuracyFigures = {
  // Figures are shown only for a metric whose acceptance criterion passed (EVID-1).
  measured: boolean;
  // The reference device or the dataset the figures were measured against.
  source: string | null;
  error: number | null;
  withinPct: number | null;
  sensitivity: number | null;
  specificity: number | null;
  auroc: number | null;
  people: number | null;
  phones: number | null;
  ci95: readonly [number, number] | null;
};

const numberIn = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const share = (value: unknown) => numberIn(value, 0, 1);
const count = (value: unknown) => {
  const found = numberIn(value, 0, Number.MAX_SAFE_INTEGER);
  return found !== null && Number.isInteger(found) ? found : null;
};

function interval(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [low, high] = value as unknown[];
  return typeof low === 'number' && typeof high === 'number' && Number.isFinite(low) && Number.isFinite(high)
    ? [low, high]
    : null;
}

// A figure the file gives in the wrong shape or range reads as untested rather than shown wrong.
export function readAccuracy(file: unknown): Record<EvidenceMetric, AccuracyFigures> {
  const evidence = readEvidence(file);
  return Object.fromEntries(
    evidenceMetrics.map((metric) => {
      const record = metricRecord(file, metric);
      const source = record.reference ?? record.dataset;
      const figures: AccuracyFigures = {
        measured: evidence[metric].measured,
        source: typeof source === 'string' ? source : null,
        error: numberIn(record.maeBpm ?? record.maeBrpm, 0, Number.MAX_VALUE),
        withinPct: numberIn(record.withinPct, 0, 100),
        sensitivity: share(record.sensitivity),
        specificity: share(record.specificity),
        auroc: share(record.auroc),
        people: count(record.people ?? record.subjects),
        phones: count(record.phones),
        ci95: interval(record.ci95),
      };
      return [metric, figures];
    }),
  ) as Record<EvidenceMetric, AccuracyFigures>;
}

export function readEvidenceDate(file: unknown): string | null {
  return isRecord(file) && typeof file.date === 'string' ? file.date : null;
}

export const bundledAccuracy = readAccuracy(bundledEvidence);
export const bundledEvidenceDate = readEvidenceDate(bundledEvidence);
