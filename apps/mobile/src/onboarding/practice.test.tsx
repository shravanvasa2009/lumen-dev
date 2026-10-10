import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

preloadAppRoutes();

describe('practice', () => {
  it('starts with no finger: a coaching line, the meter scale and zero steady seconds', () => {
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByText(en['coach.cover'])).toBeOnTheScreen();
    for (const key of ['signal.weak', 'signal.ok', 'signal.strong'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    expect(screen.getByLabelText('0 of 30 steady seconds')).toBeOnTheScreen();
    expect(screen.getByText(en['practice.pending'])).toBeOnTheScreen();
  });

  it('keeps Continue off until the 30 seconds are counted, and Skip practice goes on to the rating', () => {
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByRole('button', { name: en['common.continue'] })).toBeDisabled();
    fireEvent.press(screen.getByRole('button', { name: en['practice.skip'] }));
    expect(screen.getByRole('header', { name: en['howToSit.title'] })).toBeOnTheScreen();
  });
});
