import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

describe('placement', () => {
  it('coaches the finger position with the three tips under the drawing', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    expect(screen.getByText(en['placement.flashOutsideBump'])).toBeOnTheScreen();
    for (const key of ['placement.tipCover', 'placement.tipCase', 'placement.tipWipe'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    expect(screen.getByText(en['placement.subtitle'])).toBeOnTheScreen();
  });

  it('starts practice from the pinned button', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    fireEvent.press(screen.getByRole('button', { name: en['placement.start'] }));
    expect(screen.getByRole('header', { name: en['practice.title'] })).toBeOnTheScreen();
  });
});
