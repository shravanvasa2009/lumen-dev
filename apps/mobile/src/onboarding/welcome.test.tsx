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

  it('lists the four checks, with Diabetes marked Experimental and POTS under the Standing test', () => {
    renderRouter('./app', { initialUrl: '/welcome' });
    for (const name of ['checks.afib.name', 'checks.hrv.name', 'checks.diabetes.name', 'checks.pots.name']) {
      expect(screen.getByText(en[name as keyof typeof en])).toBeOnTheScreen();
    }
    expect(screen.getAllByText(en['checks.from.full'])).toHaveLength(3);
    expect(screen.getByText(en['checks.from.standing'])).toBeOnTheScreen();
    expect(screen.getAllByTestId('evidence-badge')).toHaveLength(1);
  });

  it('switches the screen to Spanish and back', () => {
    renderRouter('./app', { initialUrl: '/welcome' });
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    expect(screen.getByText(es['app.tagline'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: es['welcome.getStarted'] })).toBeOnTheScreen();
    expect(screen.getByText(es['checks.title'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('radio', { name: en['language.en'] }));
    expect(screen.getByText(en['app.tagline'])).toBeOnTheScreen();
  });
});
