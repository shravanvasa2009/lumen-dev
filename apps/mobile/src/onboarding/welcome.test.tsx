import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import i18next from 'i18next';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

afterEach(() => i18next.changeLanguage('en'));

preloadAppRoutes();

describe('welcome', () => {
  it('pins Get started and Try demo mode and shows the footer line', () => {
    renderRouter('./app', { initialUrl: '/welcome' });
    expect(screen.getByRole('button', { name: en['welcome.getStarted'] })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['welcome.tryDemo'] })).toBeOnTheScreen();
    expect(screen.getByText(en['welcome.footer'])).toBeOnTheScreen();
  });

  it('switches the screen to Spanish and back', () => {
    renderRouter('./app', { initialUrl: '/welcome' });
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    expect(screen.getByText(es['app.tagline'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: es['welcome.getStarted'] })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('radio', { name: en['language.en'] }));
    expect(screen.getByText(en['app.tagline'])).toBeOnTheScreen();
  });
});
