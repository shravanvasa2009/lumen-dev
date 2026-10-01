import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const appDirectory = './app';

describe('Settings tab', () => {
  it('groups the rows and marks features that do not exist yet', () => {
    renderRouter(appDirectory, { initialUrl: '/settings' });
    for (const key of [
      'settings.profile',
      'settings.accuracy',
      'settings.phone',
      'settings.widgets',
    ] as const) {
      expect(screen.getByRole('button', { name: new RegExp(en[key]) })).toBeOnTheScreen();
    }
    expect(screen.queryByRole('button', { name: new RegExp(en['settings.delete']) })).toBeNull();
    expect(screen.getAllByText(en['settings.comingSoon'])).toHaveLength(3);
    expect(screen.getByRole('switch', { name: en['settings.healthSync'] })).toBeDisabled();
  });

  it('opens Your phone and the accuracy screen from their rows', () => {
    renderRouter(appDirectory, { initialUrl: '/settings' });
    fireEvent.press(screen.getByRole('button', { name: new RegExp(en['settings.accuracy']) }));
    expect(screen.getByRole('header', { name: en['accuracy.title'] })).toBeOnTheScreen();
  });

  it('opens Lab mode on the seventh tap of the version and not before', () => {
    renderRouter(appDirectory, { initialUrl: '/settings' });
    const version = screen.getByRole('button', { name: /Version/ });
    for (let tap = 1; tap < 7; tap += 1) fireEvent.press(version);
    expect(screen.queryByRole('header', { name: en['lab.title'] })).toBeNull();
    fireEvent.press(version);
    expect(screen.getByRole('header', { name: en['lab.title'] })).toBeOnTheScreen();
  });
});

describe('Your phone', () => {
  it('says the phone is not tested yet and offers the re-test', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/phone' });
    expect(screen.getByText(en['phoneRating.notTested'])).toBeOnTheScreen();
    expect(screen.getByText(en['phoneRating.frameRate'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['phoneRating.retest'] }));
    expect(screen.getByRole('header', { name: en['phoneCheck.title'] })).toBeOnTheScreen();
  });
});
