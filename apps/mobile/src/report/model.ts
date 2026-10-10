import type { TFunction } from 'i18next';

import type { DiabetesMetric, EvidenceLabel, InconclusiveOutcome, LostCause } from '@lumen/core';

import { accuracyLines } from '@/accuracy/accuracyLines';
import { bundledAccuracy } from '@/accuracy/readAccuracy';
import { evidenceFor, type EvidenceMetric } from '@/evidence';
import type { FixtureReading } from '@/results/fixtures';
import { formatClock, formatDay } from '@/results/format';
import { isLowQuality, readingQuality, reasonText } from '@/results/quality';
import { percentShares } from '@/results/LostTime';
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

// What one metric's evidence line says after its name: the label from the evidence file, then the figures or
// "Not yet tested".
export function evidenceBody(word: string, lines: ReturnType<typeof accuracyLines>): string {
  return [`${word}.`, `${lines.headline}.`, ...lines.details.map((line) => `${line}.`)].join(' ');
}

// The Evidence paragraph shared by the card and the PDF: labels and figures come only from the evidence
// file (EVID-1), and experimental metrics have no row.
export function reportEvidenceRows(
  t: TFunction,
  language: string,
  withDiabetes: boolean,
): { heading: string; text: string }[] {
  const rows: readonly { metric: EvidenceMetric; heading: string }[] = [
    { metric: 'hr', heading: t('accuracy.heartRate') },
    { metric: 'rhythm', heading: t('accuracy.rhythm') },
    ...(withDiabetes ? [{ metric: 'diabetes' as const, heading: t('accuracy.diabetes') }] : []),
  ];
  return rows.map(({ metric, heading }) => ({
    heading,
    text: evidenceBody(
      evidenceWord(t, evidenceFor(metric).label),
      accuracyLines(metric, bundledAccuracy[metric], t, language),
    ),
  }));
}

export function reportEvidence(t: TFunction, language: string, withDiabetes: boolean): string {
  return reportEvidenceRows(t, language, withDiabetes)
    .map(({ heading, text }) => `${heading}: ${text}`)
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
      row.scan.metrics.hr
        ? marked(t, row.scan.metrics.hr, String(Math.round(row.scan.metrics.hr.value)))
        : '—',
      row.scan.metrics.rhythm
        ? marked(t, row.scan.metrics.rhythm, rhythmWords(t, row.scan.metrics.rhythm).value)
        : '—',
      String(Math.floor(row.scan.cleanSeconds)),
    ],
  }));
}

// ADR 0104: a lower-quality value is never shown without its tag.
function marked(t: TFunction, metric: object, value: string): string {
  return isLowQuality(metric) ? t('quality.marked', { value }) : value;
}

/** One line per lower-quality reading of the day: its time and why (ADR 0104). */
export function qualityLines(t: TFunction, language: string, readings: readonly FixtureReading[]): string[] {
  return readings.flatMap((row) => {
    const quality = readingQuality(row.scan);
    if (quality.level !== 'low') return [];
    const reasons = quality.reasons.map((reason) => reasonText(t, reason)).join('; ');
    return [`${formatClock(row.createdAt, language)} · ${t('quality.chip')}: ${reasons}`];
  });
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

export type MeasurementLine = { key: string; title: string; value: string; note: string };

// The opened reading's own values, one line each, for the card and the PDF. A metric the scan did not produce has
// no line, and a lower-quality value is marked (ADR 0104).
export function measurementLines(t: TFunction, reading: FixtureReading): MeasurementLine[] {
  const { hr, rhythm, rmssd, resp } = reading.scan.metrics;
  const words = (confidence: 'high' | 'moderate' | 'low') =>
    ({ high: t('confidence.high'), moderate: t('confidence.moderate'), low: t('confidence.low') })[
      confidence
    ];
  return [
    ...(hr
      ? [
          {
            key: 'hr',
            title: t('results.heartRate'),
            value: marked(t, hr, `${Math.round(hr.value)} ${t('results.unitBpm')}`),
            note: `${t('report.noteResting')} · ${words(hr.confidence)}`,
          },
        ]
      : []),
    ...(rhythm
      ? [
          {
            key: 'rhythm',
            title: t('results.heartRhythm'),
            value: marked(t, rhythm, rhythmWords(t, rhythm).value),
            note: `${rhythmWords(t, rhythm).note} · ${words(rhythm.confidence)}`,
          },
        ]
      : []),
    ...(rmssd
      ? [
          {
            key: 'hrv',
            title: t('results.hrv'),
            value: marked(t, rmssd, `${Math.round(rmssd.value)} ${t('results.unitMs')}`),
            note: rmssd.band
              ? t('results.yourBand', { low: Math.round(rmssd.band[0]), high: Math.round(rmssd.band[1]) })
              : t('results.learningBand'),
          },
        ]
      : []),
    ...(resp
      ? [
          {
            key: 'resp',
            title: t('results.breathing'),
            value: marked(t, resp, `${Math.round(resp.value)} ${t('results.unitBrpm')}`),
            note: t('report.noteResting'),
          },
        ]
      : []),
  ];
}

// The plain note a lower-quality reading carries at the top of its report; null for a standard one.
export function qualityNote(t: TFunction, reading: FixtureReading): string | null {
  const quality = readingQuality(reading.scan);
  if (quality.level !== 'low') return null;
  return `${t('report.qualityNote')} ${quality.reasons.map((reason) => reasonText(t, reason)).join('; ')}.`;
}

const contextWords = (t: TFunction): Record<string, string> => ({
  caffeine: t('precheck.caffeine'),
  exercise: t('precheck.exercise'),
  ill: t('precheck.ill'),
  medication: t('precheck.medication'),
});

// What the report of a refused capture says. Everything comes from the capture's own outcome; there are no
// heart-rate, rhythm or HRV numbers because none were measured.
export function inconclusiveLines(
  t: TFunction,
  outcome: InconclusiveOutcome,
  context: readonly string[],
): { facts: string[]; lost: string[] } {
  const seconds = Math.floor(outcome.cleanSeconds);
  const causeWords: Record<LostCause, string> = {
    motion: t('inconclusive.causeMovement'),
    pressure: t('inconclusive.causePressure'),
    coverage: t('inconclusive.causeLight'),
    coldHands: t('inconclusive.causeColdHands'),
  };
  const first = outcome.causes[0];
  const answers = context.flatMap((answer) => contextWords(t)[answer] ?? []);
  const causes: readonly LostCause[] = ['motion', 'pressure', 'coverage'];
  const shares = percentShares(causes.map((cause) => outcome.lostSeconds[cause]));
  const names = [t('inconclusive.movement'), t('inconclusive.pressure'), t('inconclusive.light')];
  const lostAny = causes.some((cause) => outcome.lostSeconds[cause] > 0);
  return {
    facts: [
      t('report.cleanOfNeeded', { seconds, needed: outcome.neededCleanSeconds }),
      ...(first ? [t('report.lostMostly', { cause: causeWords[first] })] : []),
      ...(answers.length > 0 ? [t('report.contextLine', { answers: answers.join(', ') })] : []),
      t('report.noValues'),
    ],
    lost: lostAny
      ? causes.map((_, index) =>
          t('inconclusive.rowPercent', { label: names[index], percent: shares[index] }),
        )
      : [],
  };
}
