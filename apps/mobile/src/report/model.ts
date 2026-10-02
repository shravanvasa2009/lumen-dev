import type { TFunction } from 'i18next';

import type { DiabetesMetric, EvidenceLabel } from '@lumen/core';

import type { accuracyLines } from '@/accuracy/accuracyLines';
import type { FixtureReading } from '@/results/fixtures';

export function formatFullDate(moment: Date, language: string): string {
  return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    moment,
  );
}

type Counts = { flagged: number; total: number };

// Counts are over the readings that have a result for the card; a reading that was inconclusive for it
// is not part of the "n of m".
export function flagCounts(readings: readonly FixtureReading[]): { rhythm: Counts; hr: Counts } {
  const rhythms = readings.flatMap(({ scan }) => (scan.metrics.rhythm ? [scan.metrics.rhythm] : []));
  const rates = readings.flatMap(({ scan }) => (scan.metrics.hr ? [scan.metrics.hr] : []));
  return {
    rhythm: { flagged: rhythms.filter((rhythm) => rhythm.flag !== null).length, total: rhythms.length },
    hr: { flagged: rates.filter((rate) => rate.flag !== null).length, total: rates.length },
  };
}

// ADR 0046: the diabetes line appears only when the evidence file passes the metric. Estimates from a
// metric that has not passed stay out of the report with the other experimental measurements.
export function diabetesFor(
  readings: readonly FixtureReading[],
  passed: boolean,
): { metric: DiabetesMetric; days: readonly Date[] } | null {
  if (!passed) return null;
  const found = readings.find(({ scan }) => scan.metrics.diabetes !== null);
  return found?.scan.metrics.diabetes
    ? { metric: found.scan.metrics.diabetes, days: found.diabetesDays }
    : null;
}

export function evidenceWord(t: TFunction, label: EvidenceLabel): string {
  return {
    checked: t('evidence.checked'),
    'public-data': t('evidence.publicData'),
    experimental: t('evidence.experimental'),
  }[label];
}

// The sentence for one metric: its label from the evidence file, then the figures or "Not yet tested".
export function evidenceSentence(
  heading: string,
  word: string,
  lines: ReturnType<typeof accuracyLines>,
): string {
  return [`${heading}: ${word}.`, `${lines.headline}.`, ...lines.details.map((line) => `${line}.`)].join(' ');
}
