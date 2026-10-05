import { type RatingTier, tierUnlocks } from '@lumen/core';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18next from 'i18next';

import en from '@/i18n/en.json';
import type { StoredRating } from '@/store/deviceRating';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

let mockRating: StoredRating | null = null;
jest.mock('@/store/useStoredRating', () => ({ useStoredRating: () => mockRating }));

preloadAppRoutes();

const ratingOf = (tier: RatingTier, fpsLevel: number) =>
  ({ tier, ambient: false, fpsLevel, unlocks: tierUnlocks(tier), score: 80 }) as unknown as StoredRating;

const open = async () => {
  renderRouter('./app', { initialUrl: '/measure/mode' });
  await act(async () => undefined);
};

describe('choose a mode: footer and back chevron (mockup 11)', () => {
  afterEach(() => {
    mockRating = null;
  });

  it('names the phone and its rating, and says every mode is available when nothing is locked', async () => {
    mockRating = ratingOf('full', 60);
    await open();
    expect(screen.getByText('This phone · Full rating — all modes available')).toBeOnTheScreen();
  });

  it('says some modes are locked when the rating locks one', async () => {
    mockRating = ratingOf('basic', 30);
    await open();
    expect(screen.getByText('This phone · Basic rating — some modes are locked')).toBeOnTheScreen();
  });

  it('has no footer before the phone is rated', async () => {
    await open();
    expect(screen.queryByText(/rating —/)).toBeNull();
  });

  it('puts the footer under the last mode card', async () => {
    mockRating = ratingOf('full', 60);
    await open();
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn.indexOf(en['mode.standing'])).toBeLessThan(drawn.indexOf('rating —'));
  });

  it('shows the footer in Spanish', async () => {
    mockRating = ratingOf('full', 60);
    await act(() => i18next.changeLanguage('es'));
    try {
      await open();
      expect(
        screen.getByText('Este teléfono · calificación Completa — todos los modos disponibles'),
      ).toBeOnTheScreen();
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('offers a back chevron to Home when the picker is opened with nothing behind it', async () => {
    await startOnboarded();
    await open();
    fireEvent.press(screen.getByRole('button', { name: en['common.back'] }));
    expect(await screen.findByRole('button', { name: en['home.measure'] })).toBeOnTheScreen();
  });
});
