import { renderRouter, screen } from 'expo-router/testing-library';

import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

// Reminders imports the notification module, which warns outside a development build.
jest.mock('expo-notifications', () => ({ requestPermissionsAsync: jest.fn() }));

// The mockups fill 1 segment on consent and count up by one per screen; Reminders shows all nine.
const steps = [
  ['/consent', 1],
  ['/profile', 2],
  ['/phone-check', 3],
  ['/placement', 4],
  ['/practice', 5],
  ['/how-to-sit', 6],
  ['/rating', 7],
  ['/reminders', 9],
] as const;

jest.setTimeout(30_000);

preloadAppRoutes();

describe('onboarding progress bar', () => {
  it.each(steps)('%s fills %i of 9 segments', (url, step) => {
    renderRouter('./app', { initialUrl: url });
    const progress = screen.getByLabelText(`Step ${step} of 9`);
    expect(progress.props.accessibilityValue).toMatchObject({ min: 1, max: 9, now: step });
    expect(progress.children).toHaveLength(9);
  });
});
