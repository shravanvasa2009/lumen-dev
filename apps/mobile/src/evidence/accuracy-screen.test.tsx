import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';

import AccuracyScreen from '../../app/settings/accuracy';
import en from '@/i18n/en.json';

import '@/i18n';

// The screen reads the file when its module loads, so the mock is fixed per test file. Each metric has
// a different claim; a label counts only with the passed criterion.
jest.mock('../../assets/evidence.json', () => ({
  commit: null,
  date: null,
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
    hrv: { label: 'experimental', passed: false },
    resp: { label: 'checked', passed: false },
    diabetes: { label: 'public-data', passed: false },
  },
}));

it('EVID-1: shows one badge per metric with the label the file supports', () => {
  renderRouter({ _layout: () => <Stack />, index: AccuracyScreen });
  const shown = screen.getAllByTestId('evidence-badge').map((badge) => badge.props.accessibilityLabel);
  expect(shown).toEqual([
    en['evidence.checked'],
    en['evidence.publicData'],
    en['evidence.experimental'],
    en['evidence.experimental'],
    en['evidence.experimental'],
    en['evidence.experimental'],
  ]);
  expect(screen.getByText(en['accuracy.diabetes'])).toBeTruthy();
  expect(screen.getAllByText(en['evidence.notTested'])).toHaveLength(4);
});

it('EVID-1: shows measured figures only for the metrics that passed', () => {
  renderRouter({ _layout: () => <Stack />, index: AccuracyScreen });
  expect(screen.getByText('Average error 1.6 bpm')).toBeTruthy();
  expect(screen.getByText('95% CI: 1.2–2.1 bpm')).toBeTruthy();
  expect(screen.getByText('Sensitivity 89% · specificity 94%')).toBeTruthy();
  expect(screen.getByText(en['prototype.banner'])).toBeTruthy();
  expect(screen.queryByText(/Evidence file/)).toBeNull();
});
