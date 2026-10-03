import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

preloadAppRoutes();

describe('choose a mode', () => {
  beforeEach(async () => {
    renderRouter('./app', { initialUrl: '/measure/mode' });
    // The stored rating is read when the screen opens; the picker is settled once that read has landed.
    await act(async () => undefined);
  });

  it('lists the four modes with their durations and marks Full Scan recommended', () => {
    for (const key of ['mode.full', 'mode.quick', 'mode.deep', 'mode.standing'] as const)
      expect(screen.getByRole('button', { name: en[key] })).toBeOnTheScreen();
    for (const duration of ['90 s', '30 s', '5 min', '~12 min'])
      expect(screen.getByText(duration)).toBeOnTheScreen();
    expect(screen.getAllByText(en['mode.recommended'])).toHaveLength(1);
  });

  it('opens the pre-check for Full Scan', () => {
    fireEvent.press(screen.getByRole('button', { name: en['mode.full'] }));
    expectNavTitle(en['precheck.title']);
  });

  it('opens the standing test', () => {
    fireEvent.press(screen.getByRole('button', { name: en['mode.standing'] }));
    expect(screen.getByRole('header', { name: en['standing.title'] })).toBeOnTheScreen();
  });

  it('says Deep HRV is not available yet and does not open it', () => {
    expect(screen.getByText(en['mode.deepSoon'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['mode.deep'] })).toBeDisabled();
  });
});
