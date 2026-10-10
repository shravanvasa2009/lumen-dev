import { renderRouter, screen } from 'expo-router/testing-library';

import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

// Reminders imports the notification module, which warns outside a development build.
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));

// The mockups count six steps: consent, about you, finger placement, practice, rating, reminders.
const steps = [
  ['/consent', 1],
  ['/profile', 2],
  ['/diabetes-risk', 2],
  ['/phone-check', 3],
  ['/placement', 3],
  ['/practice', 4],
  ['/how-to-sit', 4],
  ['/rating', 5],
  ['/reminders', 6],
] as const;

jest.setTimeout(30_000);

preloadAppRoutes();

describe('onboarding progress bar', () => {
  it.each(steps)('%s is step %i of 6', (url, step) => {
    renderRouter('./app', { initialUrl: url });
    const progress = screen.getByLabelText(`Step ${step} of 6`);
    expect(progress.props.accessibilityValue).toMatchObject({ min: 1, max: 6, now: step });
  });
});
