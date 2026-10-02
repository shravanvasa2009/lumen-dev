import i18next from 'i18next';

import { readingById, readingsOnDay, type FixtureReading } from '@/results/fixtures';

import { buildReportHtml } from './pdfHtml';

import '@/i18n';

// A file where every metric passed, standing in for evidence.json after the owner's tests.
// A function declaration is hoisted, so the mock factories below can call it when the imports above run.
function mockPassedFile() {
  return {
    date: '2026-10-20',
    metrics: {
      hr: { label: 'checked', passed: true, reference: 'Polar H10', maeBpm: 1.6, people: 12 },
      rhythm: {
        label: 'public-data',
        passed: true,
        dataset: 'MIMIC PERform AF',
        subjects: 35,
        sensitivity: 0.89,
        specificity: 0.94,
      },
      hrv: { label: 'experimental', passed: false },
      resp: { label: 'experimental', passed: false },
      diabetes: { label: 'public-data', passed: true, dataset: 'PPG-BP (external)', auroc: 0.78 },
      extraBeats: { label: 'experimental', passed: false },
    },
  };
}

jest.mock('@/evidence', () => {
  const actual = jest.requireActual('@/evidence');
  return { ...actual, evidenceFor: (metric: string) => actual.readEvidence(mockPassedFile())[metric] };
});
jest.mock('@/accuracy/readAccuracy', () => {
  const actual = jest.requireActual('@/accuracy/readAccuracy');
  return { ...actual, bundledAccuracy: actual.readAccuracy(mockPassedFile()) };
});

const demo = readingById('demo') as FixtureReading;
const flaggedReading = readingById('demo-flag') as FixtureReading;
const englishT = i18next.getFixedT('en');
const diabetesSentence = 'Seen on 2 readings (Sep 25, Sep 27). Not a diagnostic test.';

describe('buildReportHtml with a passed evidence file (EVID-1)', () => {
  it('takes labels and figures from the file alone and prints the card diabetes line', () => {
    const html = buildReportHtml({
      t: englishT,
      language: 'en',
      reading: demo,
      dayReadings: readingsOnDay(demo.createdAt),
      demo: true,
    });
    expect(html).toMatch(/Heart rate: Checked vs reference\. Average error 1\.6 bpm\./);
    expect(html).toMatch(/Rhythm check: Tested on public data\. Sensitivity/);
    expect(html).toContain(`Diabetes pattern:</b> ${diabetesSentence}`);
    expect(html).not.toMatch(/HRV|extra beats|pulse shape/i);
  });

  it('repeats the diabetes line on every page', () => {
    const html = buildReportHtml({
      t: englishT,
      language: 'en',
      reading: demo,
      dayReadings: [demo, flaggedReading, { ...flaggedReading, id: 'demo-flag-2' }],
      demo: true,
    });
    expect(html.match(/<section class="page">/g)).toHaveLength(2);
    expect(html.split(diabetesSentence)).toHaveLength(3);
  });
});
