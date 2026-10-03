import { renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import '@/i18n';

jest.mock('../../assets/evidence.json', () => ({
  commit: null,
  date: null,
  metrics: { rhythm: { falseAfRatePrematureReadings: 0.3, readingAbstainRate: null } },
}));

preloadAppRoutes();

it('shows the fixed development-testing line when the file gives no source', () => {
  renderRouter('./app', { initialUrl: '/learn/how-the-rhythm-check-works' });
  expect(screen.getByText(en['learn.rhythmSourceFallback'])).toBeOnTheScreen();
});
