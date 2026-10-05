import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';

import i18n from 'i18next';
import { Text as SvgText } from 'react-native-svg';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

preloadAppRoutes();

const figureLabels = () => screen.UNSAFE_getAllByType(SvgText).map((label) => label.props.children);

describe('how to sit', () => {
  it('lists the four seating checks', () => {
    renderRouter('./app', { initialUrl: '/how-to-sit' });
    for (const key of ['howToSit.elbows', 'howToSit.height', 'howToSit.hand', 'howToSit.warm'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
  });

  it('continues to the rating', () => {
    renderRouter('./app', { initialUrl: '/how-to-sit' });
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(screen.getByRole('header', { name: en['rating.title'] })).toBeOnTheScreen();
  });

  it.each(['light', 'dark'] as const)('draws the seated figure in %s colours with both labels', (scheme) => {
    mockScheme = scheme;
    renderRouter('./app', { initialUrl: '/how-to-sit' });
    const figure = screen.getByTestId('seated-illustration', { hidden: true });
    expect(figure).toBeOnTheScreen();
    expect(figureLabels()).toContain(en['howToSit.labelPhone']);
    expect(figureLabels()).toContain(en['howToSit.labelElbow']);
    expect(screen.queryByTestId('seated-press-inset', { hidden: true })).toBeNull();
  });

  it('labels the figure in Spanish, splitting the long phone label over two lines', async () => {
    mockScheme = 'light';
    await act(() => i18n.changeLanguage('es'));
    try {
      renderRouter('./app', { initialUrl: '/how-to-sit' });
      expect(figureLabels()).toContain(es['howToSit.labelElbow']);
      expect(figureLabels()).toContain('teléfono a la');
      expect(figureLabels()).toContain('altura del pecho');
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
  });

  it('sizes the figure to its container on a 360 by 640 window and still renders Continue', () => {
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1 } }));
    try {
      renderRouter('./app', { initialUrl: '/how-to-sit' });
      const style = StyleSheet.flatten(
        screen.getByTestId('seated-illustration', { hidden: true }).props.style,
      );
      expect(style.aspectRatio).toBeCloseTo(150 / 138.5);
      expect(screen.getByTestId('seated-illustration', { hidden: true }).props.width).toBe('100%');
      expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy();
      expect(screen.getByRole('button', { name: en['common.continue'] })).toBeOnTheScreen();
    } finally {
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });
});
