import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';

import AccuracyScreen from '../../app/settings/accuracy';
import { evidenceMetrics } from '@/evidence';
import en from '@/i18n/en.json';

import '@/i18n';

jest.mock('../../assets/evidence.json', () => ({
  commit: null,
  date: null,
  metrics: Object.fromEntries(
    ['hr', 'rhythm', 'hrv', 'resp', 'diabetes', 'extraBeats'].map((metric) => [
      metric,
      { label: 'checked', passed: true },
    ]),
  ),
}));

it('EVID-1: when every label passes the ring counts every check as checked', () => {
  renderRouter({ _layout: () => <Stack />, index: AccuracyScreen });
  const total = String(evidenceMetrics.length);
  expect(
    screen.getByLabelText(en['accuracy.summary'].replace('{{checked}}', total).replace('{{total}}', total)),
  ).toBeTruthy();
});
