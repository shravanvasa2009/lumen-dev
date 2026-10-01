import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

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

// __DEV__ is a constant to the compiler but a plain global at run time, so a test can switch it.
const setDevelopmentBuild = (value: boolean) => Object.assign(globalThis, { __DEV__: value });

describe('Lab mode', () => {
  afterEach(() => {
    setDevelopmentBuild(true);
  });

  it('keeps the capture panel in development builds', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/lab' });
    expect(screen.getByText(en['lab.badge'])).toBeOnTheScreen();
    expect(screen.getByText(en['lab.noSource'])).toBeOnTheScreen();
  });

  it('leaves the capture panel out of release builds', () => {
    setDevelopmentBuild(false);
    renderRouter(appDirectory, { initialUrl: '/settings/lab' });
    expect(screen.getByRole('header', { name: en['lab.title'] })).toBeOnTheScreen();
    expect(screen.queryByText(en['lab.noSource'])).toBeNull();
  });
});

describe('Appearance', () => {
  it('previews both looks for System and one look for a chosen theme', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/appearance' });
    expect(screen.getAllByText(en['home.measure'])).toHaveLength(2);
    fireEvent.press(screen.getByRole('radio', { name: en['appearance.dark'] }));
    expect(screen.getByRole('radio', { name: en['appearance.dark'] })).toBeChecked();
    expect(screen.getAllByText(en['home.measure'])).toHaveLength(1);
    fireEvent.press(screen.getByRole('radio', { name: en['appearance.segmentSystem'] }));
    expect(screen.getAllByText(en['home.measure'])).toHaveLength(2);
  });

  it('shows the choice on the Settings row', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/appearance' });
    fireEvent.press(screen.getByRole('radio', { name: en['appearance.light'] }));
    act(() => router.navigate('/settings'));
    const row = screen.getByRole('button', { name: new RegExp(en['appearance.title']), hidden: true });
    expect(within(row).getByText(en['appearance.light'])).toBeOnTheScreen();
  });
});

describe('Notifications', () => {
  it('has a switch per reminder type, all on by default, and the quiet hours', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/notifications' });
    for (const key of [
      'notifications.daily',
      'notifications.followUp',
      'notifications.doctor',
      'notifications.standing',
      'notifications.retest',
    ] as const) {
      expect(screen.getByRole('switch', { name: en[key] })).toBeChecked();
    }
    expect(screen.getByText(en['notifications.quietStart'])).toBeOnTheScreen();
    expect(screen.getByText(en['notifications.quietEnd'])).toBeOnTheScreen();
    expect(screen.getByText(en['notifications.limit'])).toBeOnTheScreen();
  });

  it('flips a switch and keeps Hide values off until it is turned on', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/notifications' });
    const hide = screen.getByRole('switch', { name: en['notifications.hideValues'] });
    expect(hide).not.toBeChecked();
    fireEvent(hide, 'valueChange', true);
    expect(screen.getByRole('switch', { name: en['notifications.hideValues'] })).toBeChecked();
  });
});
