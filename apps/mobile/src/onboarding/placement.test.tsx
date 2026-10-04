import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import tokens from '@/theme/tokens.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

preloadAppRoutes();

describe('placement', () => {
  it('coaches the finger position with the three tips under the drawing', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    expect(screen.getByText(en['placement.flashOutsideBump'])).toBeOnTheScreen();
    for (const key of ['placement.tipCover', 'placement.tipCase', 'placement.tipWipe'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    expect(screen.getByText(en['placement.subtitle'])).toBeOnTheScreen();
  });

  it('shows the instruction as a highlighted line and the tips as icon rows under a heading', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    expect(screen.getByTestId('placement-instruction')).toHaveStyle({
      backgroundColor: tokens.light.badgeCheckedBg,
    });
    expect(
      within(screen.getByTestId('placement-instruction')).getByText(en['placement.flashOutsideBump']),
    ).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en['placement.tipsHeading'] })).toBeOnTheScreen();
    const rows = screen.getAllByTestId('placement-tip');
    expect(rows).toHaveLength(3);
    ['placement.tipCover', 'placement.tipCase', 'placement.tipWipe'].forEach((key, index) => {
      expect(within(rows[index]!).getByText(en[key as keyof typeof en])).toBeOnTheScreen();
    });
  });

  it('starts practice from the pinned button', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    fireEvent.press(screen.getByRole('button', { name: en['placement.start'] }));
    expect(screen.getByRole('header', { name: en['practice.title'] })).toBeOnTheScreen();
  });
});
