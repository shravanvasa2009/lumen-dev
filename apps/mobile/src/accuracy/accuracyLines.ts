import type { TFunction } from 'i18next';

import type { EvidenceMetric } from '@/evidence';

import { formatNumber, formatPercent } from './format';
import type { AccuracyFigures } from './readAccuracy';

type AccuracyLines = { headline: string; details: readonly string[] };

// Spec 12.5 asks for the headline, the reference or dataset, the people and the interval. A figure the
// file lacks reads "Not yet tested"; a metric whose criterion has not passed shows no figures at all.
export function accuracyLines(
  metric: EvidenceMetric,
  figures: AccuracyFigures,
  t: TFunction,
  language: string,
): AccuracyLines {
  const notTested = t('evidence.notTested');
  const number = (value: number) => formatNumber(value, language);
  const percent = (value: number) => formatPercent(value, language);
  const { error, withinPct, sensitivity, specificity, auroc, people, phones, ci95, source } = figures;
  // Intervals of probabilities need two decimals to stay distinct; the heart-rate interval is in bpm.
  const digits = metric === 'hr' ? 1 : 2;
  const range = ci95
    ? `${formatNumber(ci95[0], language, digits)}–${formatNumber(ci95[1], language, digits)}`
    : null;
  const peopleLine = t('accuracy.people', { count: people === null ? notTested : number(people) });

  const sourceLines = {
    hr: source && t('accuracy.reference', { name: source }),
    hrv: source && t('accuracy.reference', { name: source }),
    resp: source && t('accuracy.reference', { name: source }),
    rhythm: source && t('accuracy.dataset', { name: source }),
    diabetes: source && t('accuracy.dataset', { name: source }),
    extraBeats: null,
  }[metric];
  let noteLine: string | null = null;
  if (metric === 'diabetes') noteLine = t('accuracy.notDiabetesTest');
  if (metric === 'extraBeats') noteLine = t('accuracy.notHealthMeasurement');

  const unmeasured = (): AccuracyLines => ({
    headline: notTested,
    details: [sourceLines, noteLine].filter((line): line is string => Boolean(line)),
  });
  if (!figures.measured) return unmeasured();

  const measured = {
    hr: {
      headline: error === null ? null : t('accuracy.hrResult', { value: number(error) }),
      details: [
        peopleLine,
        t('accuracy.phones', { count: phones === null ? notTested : number(phones) }),
        range === null ? t('accuracy.ci', { range: notTested }) : t('accuracy.ciBpm', { range }),
      ],
    },
    rhythm: {
      headline:
        sensitivity === null || specificity === null
          ? null
          : t('accuracy.rhythmResult', {
              sensitivity: percent(sensitivity),
              specificity: percent(specificity),
            }),
      details: [peopleLine, t('accuracy.ci', { range: range ?? notTested })],
    },
    hrv: {
      headline: withinPct === null ? null : t('accuracy.hrvResult', { value: number(withinPct) }),
      details: [peopleLine],
    },
    resp: {
      headline: error === null ? null : t('accuracy.respResult', { value: number(error) }),
      details: [peopleLine],
    },
    diabetes: {
      headline:
        auroc === null || sensitivity === null || specificity === null
          ? null
          : t('accuracy.diabetesResult', {
              auroc: formatNumber(auroc, language, 2),
              sensitivity: percent(sensitivity),
              specificity: percent(specificity),
            }),
      details: [t('accuracy.ci', { range: range ?? notTested })],
    },
    extraBeats: { headline: null, details: [] },
  }[metric];
  return {
    headline: measured.headline ?? notTested,
    details: [sourceLines, ...measured.details, noteLine].filter((line): line is string => Boolean(line)),
  };
}
