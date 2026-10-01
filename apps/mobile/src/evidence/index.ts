import type { EvidenceLabel } from '@lumen/core';

import bundledEvidence from '../../assets/evidence.json';

export const evidenceMetrics = ['hr', 'rhythm', 'hrv', 'resp', 'diabetes', 'extraBeats'] as const;
export type EvidenceMetric = (typeof evidenceMetrics)[number];

export type MetricEvidence = {
  label: EvidenceLabel;
  // Only a passed acceptance criterion counts as measured; null numbers read "Not yet tested" (§6.1).
  measured: boolean;
};

const weakest: MetricEvidence = { label: 'experimental', measured: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// EVID-1: anything missing or unrecognised is Experimental, and "checked" needs `passed: true` as well.
// "public-data" is taken from the file as written; the model-card half of its rule is Track D's gate.
function readMetric(metric: unknown): MetricEvidence {
  if (!isRecord(metric)) return weakest;
  const measured = metric.passed === true;
  if (metric.label === 'checked' && measured) return { label: 'checked', measured };
  if (metric.label === 'public-data') return { label: 'public-data', measured };
  return { label: 'experimental', measured };
}

export function readEvidence(file: unknown): Record<EvidenceMetric, MetricEvidence> {
  const metrics = isRecord(file) && isRecord(file.metrics) ? file.metrics : {};
  return Object.fromEntries(evidenceMetrics.map((metric) => [metric, readMetric(metrics[metric])])) as Record<
    EvidenceMetric,
    MetricEvidence
  >;
}

const bundled = readEvidence(bundledEvidence);

export function evidenceFor(metric: EvidenceMetric): MetricEvidence {
  return bundled[metric];
}
