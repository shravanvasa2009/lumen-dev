import i18next from 'i18next';

import en from '@/i18n/en.json';

import { accuracyLines } from './accuracyLines';
import { readAccuracy } from './readAccuracy';

import '@/i18n';

const passedFile = {
  commit: null,
  date: '2026-10-20',
  metrics: {
    hr: {
      label: 'checked',
      passed: true,
      reference: 'Polar H10',
      maeBpm: 1.6,
      ci95: [1.2, 2.1],
      people: 12,
      phones: 5,
    },
    rhythm: {
      label: 'public-data',
      passed: true,
      dataset: 'MIMIC PERform AF',
      subjects: 35,
      sensitivity: 0.89,
      specificity: 0.94,
    },
    hrv: { label: 'checked', passed: true, reference: 'Polar H10', withinPct: 7, people: 10 },
    resp: { label: 'checked', passed: true, reference: 'metronome', maeBrpm: 1.3, people: 8 },
    diabetes: {
      label: 'public-data',
      passed: true,
      dataset: 'PPG-BP (external)',
      auroc: 0.78,
      sensitivity: 0.63,
      specificity: 0.87,
    },
    extraBeats: { label: 'experimental', passed: false },
  },
};

const notTested = en['evidence.notTested'];
const english = i18next.getFixedT('en');

describe('accuracyLines', () => {
  const figures = readAccuracy(passedFile);

  it('EVID-1: writes each passed metric with its reference, people and interval', () => {
    expect(accuracyLines('hr', figures.hr, english, 'en')).toEqual({
      headline: 'Average error 1.6 bpm',
      details: ['Reference: Polar H10', 'People tested: 12', 'Phones tested: 5', '95% CI: 1.2–2.1 bpm'],
    });
    expect(accuracyLines('rhythm', figures.rhythm, english, 'en').headline).toBe(
      'Sensitivity 89% · specificity 94%',
    );
    expect(accuracyLines('hrv', figures.hrv, english, 'en').headline).toBe('Within 7% of the reference');
    expect(accuracyLines('resp', figures.resp, english, 'en').headline).toBe('Average error 1.3 breaths/min');
    expect(accuracyLines('diabetes', figures.diabetes, english, 'en')).toEqual({
      headline: 'AUROC 0.78 · sensitivity 63% · specificity 87%',
      details: ['Dataset: PPG-BP (external)', `95% CI: ${notTested}`, en['accuracy.notDiabetesTest']],
    });
  });

  it('EVID-1: a metric that has not passed shows "Not yet tested" even when the file holds numbers', () => {
    const unpassed = readAccuracy({
      metrics: { hr: { label: 'checked', passed: false, reference: 'Polar H10', maeBpm: 1.6, people: 12 } },
    });
    expect(accuracyLines('hr', unpassed.hr, english, 'en')).toEqual({
      headline: notTested,
      details: ['Reference: Polar H10'],
    });
  });

  it('EVID-1: a passed metric with a null figure shows "Not yet tested" for that figure', () => {
    const sparse = readAccuracy({ metrics: { hr: { label: 'checked', passed: true, maeBpm: null } } });
    const { headline, details } = accuracyLines('hr', sparse.hr, english, 'en');
    expect(headline).toBe(notTested);
    expect(details).toEqual([
      `People tested: ${notTested}`,
      `Phones tested: ${notTested}`,
      `95% CI: ${notTested}`,
    ]);
  });

  it('keeps extra beats at "Not yet tested" with the not-a-measurement note', () => {
    expect(accuracyLines('extraBeats', figures.extraBeats, english, 'en')).toEqual({
      headline: notTested,
      details: [en['accuracy.notHealthMeasurement']],
    });
  });

  it('writes the same rows in Spanish with a decimal comma', () => {
    const { headline, details } = accuracyLines('hr', figures.hr, i18next.getFixedT('es'), 'es');
    expect(headline).toBe('Error promedio de 1,6 lpm');
    expect(details).toContain('IC del 95%: 1,2–2,1 lpm');
  });
});
