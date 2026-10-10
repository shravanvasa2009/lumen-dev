import { Stack } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import AccuracyScreen from '../../app/settings/accuracy';
import en from '@/i18n/en.json';

import '@/i18n';

jest.mock('../../assets/evidence.json', () => ({
  commit: null,
  date: '2026-10-20',
  metrics: {
    diabetes: {
      label: 'public-data',
      passed: true,
      dataset: 'PPG-BP (external)',
      auroc: 0.78,
      sensitivity: 0.63,
      specificity: 0.87,
      ci95: [0.7, 0.85],
    },
  },
}));

it('EVID-1: shows the diabetes row with its dataset, interval, and the not-a-test note, and the file date', () => {
  renderRouter({ _layout: () => <Stack />, index: AccuracyScreen });
  expect(screen.getByText('AUROC 0.78 · sensitivity 63% · specificity 87%')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: new RegExp(en['accuracy.diabetes']) }));
  expect(screen.getByText('Dataset: PPG-BP (external)')).toBeTruthy();
  expect(screen.getByText('95% CI: 0.7–0.85')).toBeTruthy();
  expect(screen.getByText(en['accuracy.notDiabetesTest'])).toBeTruthy();
  expect(screen.getByText('Evidence file Oct 20')).toBeTruthy();
  expect(screen.getAllByText(en['evidence.notTested'])).toHaveLength(6);
});
