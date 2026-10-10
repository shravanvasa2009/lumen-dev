import { Platform } from 'react-native';
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
  const originalOs = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'android';
  });
  afterEach(() => {
    Platform.OS = originalOs;
  });

  it('coaches the finger position with the three tips under the drawing', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    expect(screen.getByText(en['placement.instructionAndroid'])).toBeOnTheScreen();
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
      within(screen.getByTestId('placement-instruction')).getByText(en['placement.instructionAndroid']),
    ).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en['placement.tipsHeading'] })).toBeOnTheScreen();
    for (const key of ['placement.tipCover', 'placement.tipCase', 'placement.tipWipe', 'placement.tipPosture'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    expect(screen.getByText(en['placement.tipWarm'])).toBeOnTheScreen();
  });

  it('starts practice from the pinned button', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    fireEvent.press(screen.getByRole('button', { name: en['placement.start'] }));
    expect(screen.getByRole('header', { name: en['practice.title'] })).toBeOnTheScreen();
  });

  it.each([
    ['android', 'galaxyA17', 'placement.instructionAndroid', 'placement.figureLabelAndroid'],
    ['ios', 'iphone17Pro', 'placement.instructionIos', 'placement.figureLabelIos'],
  ] as const)('draws the %s phone and names its lens', (os, model, instructionKey, figureKey) => {
    Platform.OS = os;
    renderRouter('./app', { initialUrl: '/placement' });
    expect(screen.getByTestId(`placement-figure-${model}`, { hidden: true })).toBeOnTheScreen();
    expect(screen.getByLabelText(en[figureKey])).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('placement-instruction')).getByText(en[instructionKey]),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('icon-finger', { hidden: true })).toBeOnTheScreen();
  });
});
