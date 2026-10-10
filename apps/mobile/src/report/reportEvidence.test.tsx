import { renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

// A file where every metric passed, standing in for evidence.json after the owner's tests.
const mockPassedFile = {
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

jest.mock('@/evidence', () => {
  const actual = jest.requireActual('@/evidence');
  return { ...actual, evidenceFor: (metric: string) => actual.readEvidence(mockPassedFile)[metric] };
});
jest.mock('@/accuracy/readAccuracy', () => {
  const actual = jest.requireActual('@/accuracy/readAccuracy');
  return { ...actual, bundledAccuracy: actual.readAccuracy(mockPassedFile) };
});

preloadAppRoutes();

describe('Doctor report with a passed evidence file (EVID-1)', () => {
  it('takes labels and figures from the file alone', () => {
    renderRouter('./app', { initialUrl: '/report/demo' });
    expect(screen.getByText(/Heart rate: Checked vs reference\. Average error 1\.6 bpm\./)).toBeOnTheScreen();
    expect(screen.getByText(/Rhythm check: Tested on public data\. Sensitivity/)).toBeOnTheScreen();
    expect(screen.getByText(/People tested: 35/)).toBeOnTheScreen();
  });

  it('adds the diabetes line, saying it is not a diagnostic test and naming no model version', () => {
    renderRouter('./app', { initialUrl: '/report/demo' });
    const line = screen.getByText(/Seen on 2 readings \(Sep 25, Sep 27\)\. Not a diagnostic test\./);
    expect(line).toBeOnTheScreen();
    expect(screen.getAllByText(en['report.diabetesLabel']).length).toBeGreaterThan(0);
    expect(screen.getByText(/Diabetes pattern: Tested on public data\./)).toBeOnTheScreen();
    expect(screen.queryByText(/diabetes-net|\d+\.\d+\.\d+/)).toBeNull();
  });
});
