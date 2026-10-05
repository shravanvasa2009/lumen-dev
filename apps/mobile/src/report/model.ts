import type { TFunction } from 'i18next';

import type { DiabetesMetric, EvidenceLabel } from '@lumen/core';

import { accuracyLines } from '@/accuracy/accuracyLines';
import { bundledAccuracy } from '@/accuracy/readAccuracy';
import { evidenceFor, type EvidenceMetric } from '@/evidence';
import type { FixtureReading } from '@/results/fixtures';
import { formatClock, formatDay } from '@/results/format';
import { rhythmWords } from '@/results/rhythmWords';

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

function evidenceWord(t: TFunction, label: EvidenceLabel): string {
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

// The Evidence paragraph shared by the card and the PDF: labels and figures come only from the evidence
// file (EVID-1), and experimental metrics have no row.
export function reportEvidence(t: TFunction, language: string, withDiabetes: boolean): string {
  const rows: readonly { metric: EvidenceMetric; heading: string }[] = [
    { metric: 'hr', heading: t('accuracy.heartRate') },
    { metric: 'rhythm', heading: t('accuracy.rhythm') },
    ...(withDiabetes ? [{ metric: 'diabetes' as const, heading: t('accuracy.diabetes') }] : []),
  ];
  return rows
    .map(({ metric, heading }) =>
      evidenceSentence(
        heading,
        evidenceWord(t, evidenceFor(metric).label),
        accuracyLines(metric, bundledAccuracy[metric], t, language),
      ),
    )
    .join(' ');
}

// The PDF has one page per flagged reading of the day. A day with no flag still gets one page, for the
// reading that was opened, so Share works on a regular reading.
export function pdfPageReadings(
  opened: FixtureReading,
  dayReadings: readonly FixtureReading[],
): readonly FixtureReading[] {
  const flagged = dayReadings.filter(
    ({ scan }) => Boolean(scan.metrics.rhythm?.flag) || Boolean(scan.metrics.hr?.flag),
  );
  return flagged.length > 0 ? flagged : [opened];
}

export function columnHeadings(t: TFunction): string[] {
  return [
    t('report.colTime'),
    t('report.colMode'),
    t('report.colHr'),
    t('report.colRhythm'),
    t('report.colClean'),
  ];
}

// One row per reading of the day; a dash stands where a card had no result.
export function tableRows(
  t: TFunction,
  language: string,
  readings: readonly FixtureReading[],
): { id: string; cells: string[] }[] {
  return readings.map((row) => ({
    id: row.id,
    cells: [
      formatClock(row.createdAt, language),
      row.mode === 'full' ? t('report.modeFull') : t('report.modeQuick'),
      row.scan.metrics.hr ? String(Math.round(row.scan.metrics.hr.value)) : '—',
      row.scan.metrics.rhythm ? rhythmWords(t, row.scan.metrics.rhythm).value : '—',
      String(Math.floor(row.scan.cleanSeconds)),
    ],
  }));
}

const stripLimit = 3;

// The interval strips to draw: the first few readings of the day that have intervals.
export function stripsFor(
  t: TFunction,
  language: string,
  readings: readonly FixtureReading[],
): { id: string; caption: string; intervalsMs: readonly number[]; flagged: boolean }[] {
  return readings
    .filter(({ intervalsMs }) => intervalsMs.length > 0)
    .slice(0, stripLimit)
    .map((row) => ({
      id: row.id,
      caption: t('report.intervalStrip', {
        time: formatClock(row.createdAt, language),
        mode: row.mode === 'full' ? t('mode.full') : t('mode.quick'),
      }),
      intervalsMs: row.intervalsMs,
      flagged: Boolean(row.scan.metrics.rhythm?.flag),
    }));
}

// The sentence for the diabetes line, shared by the card and the PDF.
export function diabetesSentence(
  t: TFunction,
  language: string,
  diabetes: { metric: DiabetesMetric; days: readonly Date[] },
): string {
  return [
    diabetes.metric.flag === 'pattern'
      ? t('results.diabetesSeen', {
          readings: diabetes.metric.readingsUsed,
          days: diabetes.days.map((day) => formatDay(day, language)).join(', '),
        })
      : t('report.diabetesNotSeen'),
    t('report.notDiagnostic'),
  ].join(' ');
}
