import { renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

import '@/i18n';

// The lesson reads the file when its module loads, so the mock is fixed for this test file.
jest.mock('../../assets/evidence.json', () => ({
  commit: null,
  date: null,
  metrics: {
    rhythm: {
      label: 'experimental',
      passed: false,
      falseAfRatePrematureReadings: { estimate: 0.3, ci95: [0.09, 0.61] },
      readingAbstainRate: 0.12,
    },
  },
}));

it('shows both rhythm figures from evidence.json as percentages', () => {
  renderRouter('./app', { initialUrl: '/learn/how-the-rhythm-check-works' });
  expect(screen.getByText(en['learn.rhythmFalseAf'].replace('{{rate}}', '30%'))).toBeOnTheScreen();
  expect(screen.getByText(en['learn.rhythmAbstain'].replace('{{rate}}', '12%'))).toBeOnTheScreen();
  expect(screen.queryByText(en['evidence.notTested'])).toBeNull();
});
