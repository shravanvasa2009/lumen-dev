import { screen } from '@testing-library/react-native';
import { fireEvent, renderRouter } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

// Continue opens Reminders, which imports the notification module; it warns outside a development build.
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(),
  useLastNotificationResponse: () => null,
}));

describe('rating screen', () => {
  it('says the rating is pending instead of showing a made-up score', () => {
    renderRouter('./app', { initialUrl: '/rating' });
    expect(screen.getByText(en['rating.pending'])).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  it('continues to Reminders', () => {
    renderRouter('./app', { initialUrl: '/rating' });
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(screen.getByRole('header', { name: en['reminders.title'] })).toBeOnTheScreen();
  });
});
