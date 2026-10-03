import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { Dimensions, Linking, Platform, ScrollView, StyleSheet } from 'react-native';

import en from '@/i18n/en.json';
import { expectNavTitle, focusedNavHeader, sheetScreenProps } from '@/testing/navHeader';
import { lockscreenStrings } from '@/i18n/lockscreen';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { setPreference } from '@/theme/preferences';
import tokens from '@/theme/tokens.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

// The jest safe-area context reports no insets, so the top inset is pinned to prove the cap subtracts it.
const STATUS_BAR_INSET = 24;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: STATUS_BAR_INSET, bottom: 0, left: 0, right: 0 }),
}));

fixClockAtMorning();

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const appDirectory = './app';

// The preferences live in module state, so every test starts from the shipped defaults.
beforeEach(() => {
  act(() => {
    setPreference('appearance', 'system');
    setPreference('hideWidgetValues', false);
  });
});

preloadAppRoutes();

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
    expect(screen.getAllByText(en['settings.comingSoon'])).toHaveLength(5);
    expect(screen.queryByRole('button', { name: new RegExp(en['settings.demoMode']) })).toBeNull();
    expect(screen.queryByText(/8:00/)).toBeNull();
    const reminders = screen.getByRole('button', { name: new RegExp(en['notifications.title']) });
    expect(within(reminders).getByText(en['settings.notActiveYet'])).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: en['settings.healthSync'] })).toBeDisabled();
  });

  it('opens Your phone and the accuracy screen from their rows', () => {
    renderRouter(appDirectory, { initialUrl: '/settings' });
    fireEvent.press(screen.getByRole('button', { name: new RegExp(en['settings.accuracy']) }));
    expectNavTitle(en['accuracy.title']);
  });

  it('opens Lab mode on the seventh tap of the version and not before', () => {
    renderRouter(appDirectory, { initialUrl: '/settings' });
    const version = screen.getByRole('button', { name: /Version/ });
    for (let tap = 1; tap < 7; tap += 1) fireEvent.press(version);
    expect(focusedNavHeader()?.title).not.toBe(en['lab.title']);
    fireEvent.press(version);
    expectNavTitle(en['lab.title']);
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
    expectNavTitle(en['lab.title']);
    expect(screen.queryByText(en['lab.noSource'])).toBeNull();
  });
});

describe('Appearance', () => {
  it('previews both looks for System and one look for a chosen theme', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/appearance' });
    expect(screen.getAllByText(en['home.measure'])).toHaveLength(2);
    expect(screen.getByText(en['appearance.followingBody'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('radio', { name: en['appearance.dark'] }));
    expect(screen.getByRole('radio', { name: en['appearance.dark'] })).toBeChecked();
    expect(screen.getAllByText(en['home.measure'])).toHaveLength(1);
    fireEvent.press(screen.getByRole('radio', { name: en['appearance.segmentSystem'] }));
    expect(screen.getAllByText(en['home.measure'])).toHaveLength(2);
  });

  it('hides the following-the-phone note once a look is chosen', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/appearance' });
    fireEvent.press(screen.getByRole('radio', { name: en['appearance.dark'] }));
    expect(screen.queryByText(en['appearance.followingBody'])).toBeNull();
  });

  it('recolours another screen when Light is chosen on a dark phone', () => {
    renderRouter(appDirectory, { initialUrl: '/settings' });
    const versionNote = () => screen.getByText(new RegExp(en['settings.version'].split('{{')[0]!));
    expect(versionNote()).toHaveStyle({ color: tokens.dark.textFaint });
    act(() => router.navigate('/settings/appearance'));
    fireEvent.press(screen.getByRole('radio', { name: en['appearance.light'] }));
    act(() => router.navigate('/settings'));
    expect(versionNote()).toHaveStyle({ color: tokens.light.textFaint });
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
  it('says nothing is active yet and shows every reminder switch disabled', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/notifications' });
    expect(screen.getByText(en['notifications.notActive'])).toBeOnTheScreen();
    for (const key of [
      'notifications.daily',
      'notifications.followUp',
      'notifications.doctor',
      'notifications.standing',
      'notifications.retest',
      'notifications.hideValues',
    ] as const) {
      const reminder = screen.getByRole('switch', { name: en[key] });
      expect(reminder).toBeDisabled();
      expect(reminder).not.toBeChecked();
    }
    expect(screen.getByText(en['notifications.quietStart'])).toBeOnTheScreen();
    expect(screen.getByText(en['notifications.limit'])).toBeOnTheScreen();
  });
});

describe('Widget gallery', () => {
  const phoneOs = Platform.OS;
  afterEach(() => {
    Platform.OS = phoneOs;
  });

  const stepKeys = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index + 1}` as keyof typeof en);

  it('on iPhone shows the home and lock-screen previews with their steps', () => {
    Platform.OS = 'ios';
    renderRouter(appDirectory, { initialUrl: '/settings/widgets' });
    expect(screen.getByText(en['widgets.sample'])).toBeOnTheScreen();
    expect(screen.getByText(en['widgets.iphoneHome'])).toBeOnTheScreen();
    expect(screen.getByText(en['widgets.iphoneLock'])).toBeOnTheScreen();
    expect(screen.getAllByText(en['widgets.checkNow'])).toHaveLength(2);
    expect(screen.getByText('64')).toBeOnTheScreen();
    expect(screen.getByText(en['widgets.buttons'])).toBeOnTheScreen();
    for (const [prefix, count] of [
      ['widgets.iphoneHomeStep', 5],
      ['widgets.iphoneLockStep', 4],
    ] as const) {
      stepKeys(prefix, count).forEach((key, index) => {
        expect(screen.getByLabelText(`${index + 1}. ${en[key]}`)).toBeOnTheScreen();
      });
    }
    expect(screen.getByRole('button', { name: en['widgets.lockScreenLink'] })).toBeOnTheScreen();
    expect(screen.queryByText(en['widgets.android'])).toBeNull();
    expect(screen.queryByLabelText(`2. ${en['widgets.androidStep2']}`)).toBeNull();
  });

  it('on Android shows the Android previews and steps, and no lock-screen section or link', () => {
    Platform.OS = 'android';
    renderRouter(appDirectory, { initialUrl: '/settings/widgets' });
    expect(screen.getByText(en['widgets.sample'])).toBeOnTheScreen();
    expect(screen.getByText(en['widgets.android'])).toBeOnTheScreen();
    expect(screen.getAllByText(en['widgets.checkNow'])).toHaveLength(2);
    expect(screen.getByText(en['mode.full'])).toBeOnTheScreen();
    expect(screen.getByText('64')).toBeOnTheScreen();
    expect(screen.getByText(en['widgets.buttons'])).toBeOnTheScreen();
    stepKeys('widgets.androidStep', 4).forEach((key, index) => {
      expect(screen.getByLabelText(`${index + 1}. ${en[key]}`)).toBeOnTheScreen();
    });
    expect(screen.queryByText(en['widgets.iphoneHome'])).toBeNull();
    expect(screen.queryByText(en['widgets.iphoneLock'])).toBeNull();
    expect(screen.queryByText(/iPhone/)).toBeNull();
    expect(screen.queryByRole('button', { name: en['widgets.lockScreenLink'] })).toBeNull();
  });

  it('hides the sample number when Hide values on widgets is on', () => {
    act(() => setPreference('hideWidgetValues', true));
    renderRouter(appDirectory, { initialUrl: '/settings/widgets' });
    expect(screen.queryByText('64')).toBeNull();
  });

  it('on Android leaves the whole reading row out when values are hidden, like the real widget', () => {
    Platform.OS = 'android';
    act(() => setPreference('hideWidgetValues', true));
    renderRouter(appDirectory, { initialUrl: '/settings/widgets' });
    expect(screen.queryByText('64')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByText(en['widgets.bpm'])).toBeNull();
    expect(screen.getAllByText(en['widgets.checkNow'])).toHaveLength(2);
  });

  it('on iPhone headings the two step lists differently', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/widgets' });
    expect(screen.getByRole('header', { name: en['widgets.stepsTitle'] })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en['widgets.stepsTitleLock'] })).toBeOnTheScreen();
  });

  it('opens the lock-screen previews', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/widgets' });
    fireEvent.press(screen.getByRole('button', { name: en['widgets.lockScreenLink'] }));
    expectNavTitle(en['lockScreen.title']);
  });
});

describe('Lock-screen previews', () => {
  it('shows the standing timer and a reminder with no health details', () => {
    renderRouter(appDirectory, { initialUrl: '/settings/widgets/lock-screen' });
    expect(screen.getByText(lockscreenStrings('en')['live.standing.tap'])).toBeOnTheScreen();
    expect(screen.getByText(en['lockScreen.sample'])).toBeOnTheScreen();
    expect(screen.getByLabelText(en['lockScreen.timer'])).toBeOnTheScreen();
    expect(screen.getByLabelText(en['lockScreen.reminder'])).toBeOnTheScreen();
    expect(screen.getByText(lockscreenStrings('en')['notif.confirm'])).toBeOnTheScreen();
    expect(screen.queryByText(/bpm/i)).toBeNull();
  });
});

describe('Doctor follow-up', () => {
  afterEach(() => jest.restoreAllMocks());

  it('offers the three answers and the test to ask for', () => {
    renderRouter(appDirectory, { initialUrl: '/follow-up' });
    for (const key of ['followUp.saw', 'followUp.booked', 'followUp.notYet'] as const) {
      expect(screen.getByRole('button', { name: en[key] })).toBeOnTheScreen();
    }
    expect(screen.getByText(en['followUp.whatToAskBody'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['followUp.booked'] }));
    expect(screen.getByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
  });

  it('is a native form sheet with its own grabber, not a hand-drawn card', () => {
    // A stack's first screen is always pushed, so the sheet is opened from Home like a person would.
    renderRouter(appDirectory, { initialUrl: '/' });
    fireEvent.press(screen.getByRole('button', { name: en['home.followUp'] }));
    expect(sheetScreenProps()).toMatchObject({
      stackPresentation: 'formSheet',
      sheetGrabberVisible: true,
      // react-native-screens turns 'fitToContents' into the single detent -1 before the native view.
      sheetAllowedDetents: [-1],
    });
  });

  it('draws its own grabber on Android only, where sheetGrabberVisible does nothing', () => {
    const platform = Platform.OS;
    try {
      Platform.OS = 'android';
      renderRouter(appDirectory, { initialUrl: '/follow-up' });
      expect(screen.getByTestId('sheet-grabber')).toBeOnTheScreen();
      screen.unmount();
      Platform.OS = 'ios';
      renderRouter(appDirectory, { initialUrl: '/follow-up' });
      expect(screen.queryByTestId('sheet-grabber')).toBeNull();
    } finally {
      Platform.OS = platform;
    }
  });

  it('caps the sheet content below the window height so tall text scrolls', () => {
    const originalWindow = Dimensions.get('window');
    act(() => Dimensions.set({ window: { width: 360, height: 640, scale: 2, fontScale: 1 } }));
    try {
      renderRouter(appDirectory, { initialUrl: '/follow-up' });
      const { maxHeight } = StyleSheet.flatten(screen.UNSAFE_getByType(ScrollView).props.style);
      expect(maxHeight).toBe(640 - STATUS_BAR_INSET);
    } finally {
      act(() => Dimensions.set({ window: originalWindow }));
    }
  });

  it('closes the sheet before the Care map opens, so Back returns to Home', async () => {
    renderRouter(appDirectory, { initialUrl: '/' });
    fireEvent.press(screen.getByRole('button', { name: en['home.followUp'] }));
    fireEvent.press(screen.getByRole('button', { name: en['careMap.enter'] }));
    expectNavTitle(en['careMap.title']);
    expect(screen.queryByRole('header', { name: en['followUp.title'] })).toBeNull();
    await screen.findByText(en['careMap.denied']);
  });

  it('opens the Care map from Find a doctor nearby', async () => {
    renderRouter(appDirectory, { initialUrl: '/follow-up' });
    fireEvent.press(screen.getByRole('button', { name: en['careMap.enter'] }));
    expectNavTitle(en['careMap.title']);
    await screen.findByText(en['careMap.denied']);
  });

  it('opens the health-center finder only when the link is tapped', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    renderRouter(appDirectory, { initialUrl: '/follow-up' });
    expect(openURL).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('link', { name: en['followUp.careFinder'] }));
    expect(openURL).toHaveBeenCalledWith('https://findahealthcenter.hrsa.gov');
  });

  it('says what to do when the page cannot open', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no browser'));
    renderRouter(appDirectory, { initialUrl: '/follow-up' });
    fireEvent.press(screen.getByRole('link', { name: en['followUp.careFinder'] }));
    expect(await screen.findByText(en['followUp.careFinderFailed'])).toBeOnTheScreen();
  });
});
