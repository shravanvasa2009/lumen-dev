import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

preloadAppRoutes();

describe('consent', () => {
  it('lists what Lumen can and cannot do and the 911 note', () => {
    renderRouter('./app', { initialUrl: '/consent' });
    for (const key of ['consent.canPulse', 'consent.cannotDiagnose', 'consent.callWarning'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
  });

  it('keeps Continue off until the box is ticked, and off again when it is cleared', () => {
    renderRouter('./app', { initialUrl: '/consent' });
    const checkbox = screen.getByRole('checkbox', { name: en['consent.understand'] });
    expect(screen.getByRole('button', { name: en['common.continue'] })).toBeDisabled();
    fireEvent.press(checkbox);
    expect(screen.getByRole('button', { name: en['common.continue'] })).toBeEnabled();
    fireEvent.press(checkbox);
    expect(screen.getByRole('button', { name: en['common.continue'] })).toBeDisabled();
  });

  it('goes to About you once ticked', () => {
    renderRouter('./app', { initialUrl: '/consent' });
    fireEvent.press(screen.getByRole('checkbox', { name: en['consent.understand'] }));
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(screen.getByRole('header', { name: en['profile.title'] })).toBeOnTheScreen();
  });
});
