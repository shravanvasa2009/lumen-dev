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

const mockWindow = { width: 390, height: 844 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindow, scale: 1, fontScale: 1 }),
}));

describe('welcome', () => {
  beforeEach(() => {
    Object.assign(mockWindow, { width: 390, height: 844 });
  });

  it('pins Get started and Try demo mode and shows the footer line', () => {
    renderRouter('./app', { initialUrl: '/welcome' });
    expect(screen.getByRole('button', { name: en['welcome.getStarted'] })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['welcome.tryDemo'] })).toBeOnTheScreen();
    expect(screen.getByText(en['welcome.footer'])).toBeOnTheScreen();
  });

  it('lists the four checks, with no Experimental tag', () => {
    renderRouter('./app', { initialUrl: '/welcome' });
    for (const name of ['checks.afib.name', 'checks.hrv.name', 'checks.diabetes.pattern', 'checks.pots.name']) {
      expect(screen.getByText(en[name as keyof typeof en])).toBeOnTheScreen();
    }
    expect(screen.queryByTestId('evidence-badge')).toBeNull();
  });

  it('keeps all four checks and the buttons on a 360 x 640 window', () => {
    Object.assign(mockWindow, { width: 360, height: 640 });
    renderRouter('./app', { initialUrl: '/welcome' });
    for (const name of [
      'checks.afib.name',
      'checks.hrv.name',
      'checks.diabetes.pattern',
      'checks.pots.name',
    ] as const) {
      expect(screen.getByText(en[name])).toBeOnTheScreen();
    }
    expect(screen.getByRole('button', { name: en['welcome.getStarted'] })).toBeOnTheScreen();
  });

  it('switches the screen to Spanish and back', () => {
    renderRouter('./app', { initialUrl: '/welcome' });
    fireEvent.press(screen.getByRole('button', { name: en['language.label'] }));
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    expect(screen.getByText(es['app.tagline'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: es['welcome.getStarted'] })).toBeOnTheScreen();
    expect(screen.getByLabelText(es['checks.title'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: es['language.label'] }));
    fireEvent.press(screen.getByRole('radio', { name: en['language.en'] }));
    expect(screen.getByText(en['app.tagline'])).toBeOnTheScreen();
  });
});
