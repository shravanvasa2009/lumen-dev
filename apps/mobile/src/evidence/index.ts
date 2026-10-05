import type { EvidenceLabel } from '@lumen/core';

import bundledEvidence from '../../assets/evidence.json';

export const evidenceMetrics = ['hr', 'rhythm', 'hrv', 'resp', 'diabetes', 'extraBeats'] as const;
export type EvidenceMetric = (typeof evidenceMetrics)[number];
// The questionnaire has no evidence.json entry yet, so it reads as Experimental, and it has no
// accuracy-screen row, so it stays out of evidenceMetrics.
export type EvidenceKey = EvidenceMetric | 'questionnaire';

export type MetricEvidence = {
  label: EvidenceLabel;
  // Only a passed acceptance criterion counts as measured; null numbers read "Not yet tested" (§6.1).
  measured: boolean;
};

const weakest: MetricEvidence = { label: 'experimental', measured: false };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// EVID-1: a label above Experimental needs the file to say so and `passed: true` (spec 6.2, ML-6).
// Anything missing, unrecognised or unpassed is Experimental, and `measured` follows the shown label so
// a badge never sits next to "Not yet tested".
function readMetric(metric: unknown): MetricEvidence {
  if (!isRecord(metric) || metric.passed !== true) return weakest;
  if (metric.label === 'checked') return { label: 'checked', measured: true };
  if (metric.label === 'public-data') return { label: 'public-data', measured: true };
  return weakest;
}

export function readEvidence(file: unknown): Record<EvidenceMetric, MetricEvidence> {
  const metrics = isRecord(file) && isRecord(file.metrics) ? file.metrics : {};
  return Object.fromEntries(evidenceMetrics.map((metric) => [metric, readMetric(metrics[metric])])) as Record<
    EvidenceMetric,
    MetricEvidence
  >;
}

// The raw record of one metric, for screens that show its figures. It applies no gating: each caller decides
// whether its figures depend on the label (readEvidence) or not (rhythm explainer figures).
export function metricRecord(file: unknown, metric: EvidenceKey): Record<string, unknown> {
  const metrics = isRecord(file) && isRecord(file.metrics) ? file.metrics : {};
  const record = metrics[metric];
  return isRecord(record) ? record : {};
}

const bundled: Record<EvidenceKey, MetricEvidence> = {
  ...readEvidence(bundledEvidence),
  questionnaire: readMetric(metricRecord(bundledEvidence, 'questionnaire')),
};

export function evidenceFor(metric: EvidenceKey): MetricEvidence {
  return bundled[metric];
}
