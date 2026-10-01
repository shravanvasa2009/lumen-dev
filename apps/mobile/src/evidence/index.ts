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

const bundled = readEvidence(bundledEvidence);

export function evidenceFor(metric: EvidenceMetric): MetricEvidence {
  return bundled[metric];
}
