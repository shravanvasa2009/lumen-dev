import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

preloadAppRoutes();

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
});
