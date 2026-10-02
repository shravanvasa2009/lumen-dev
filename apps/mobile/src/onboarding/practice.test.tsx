import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

describe('practice', () => {
  it('starts with no finger: a coaching line, the meter scale and zero steady seconds', () => {
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByText(en['coach.cover'])).toBeOnTheScreen();
    for (const key of ['signal.weak', 'signal.ok', 'signal.strong'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    expect(screen.getByText('0 of 15 steady seconds')).toBeOnTheScreen();
    expect(screen.getByText(en['practice.pending'])).toBeOnTheScreen();
  });

  it('continues to How to sit', () => {
    renderRouter('./app', { initialUrl: '/practice' });
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(screen.getByRole('header', { name: en['howToSit.title'] })).toBeOnTheScreen();
  });
});
