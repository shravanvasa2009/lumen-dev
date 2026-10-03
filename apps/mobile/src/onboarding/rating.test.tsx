import { screen } from '@testing-library/react-native';
import { fireEvent, renderRouter } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

// Continue opens Reminders, which imports the notification module; it warns outside a development build.
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));

preloadAppRoutes();

describe('rating screen', () => {
  it('says the rating is pending instead of showing a made-up score', async () => {
    renderRouter('./app', { initialUrl: '/rating' });
    expect(await screen.findByText(en['rating.pending'])).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  it('continues to Reminders', async () => {
    renderRouter('./app', { initialUrl: '/rating' });
    await screen.findByText(en['rating.pending']);
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(screen.getByRole('header', { name: en['reminders.title'] })).toBeOnTheScreen();
  });
});
