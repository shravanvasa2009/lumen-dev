import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import en from '@/i18n/en.json';
import { memoryFiles, mockFileSystem } from '@/testing/memoryFiles';
import { loadNotificationPrefs } from '@/notifications/prefs';
import { syncNotifications } from '@/notifications/scheduler';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { setPreference } from '@/theme/preferences';

fixClockAtMorning();

jest.mock('expo-file-system', () => mockFileSystem);
jest.mock('@/notifications/scheduler', () => ({ syncNotifications: jest.fn(async () => undefined) }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));

const appDirectory = './app';
const permissionNow = jest.mocked(getPermissionsAsync);
const permissionAsk = jest.mocked(requestPermissionsAsync);
const sync = jest.mocked(syncNotifications);

type PermissionAnswer = Awaited<ReturnType<typeof getPermissionsAsync>>;
const answer = (status: 'granted' | 'denied' | 'undetermined') =>
  ({ status, granted: status === 'granted', canAskAgain: status !== 'denied' }) as PermissionAnswer;

jest.setTimeout(30_000);
preloadAppRoutes();

beforeEach(() => {
  memoryFiles.clear();
  sync.mockClear();
  permissionAsk.mockReset();
  permissionNow.mockReset();
  permissionNow.mockResolvedValue(answer('granted'));
  act(() => setPreference('hideWidgetValues', false));
});

const open = async () => {
  renderRouter(appDirectory, { initialUrl: '/settings/notifications' });
  await screen.findByRole('switch', { name: en['notifications.daily'] });
};
const switchNamed = (key: keyof typeof en) => screen.getByRole('switch', { name: en[key] });

describe('Notifications settings', () => {
  it('shows the saved choices, not a placeholder', async () => {
    await open();
    expect(switchNamed('notifications.daily')).not.toBeChecked();
    expect(switchNamed('notifications.followUp')).toBeChecked();
    expect(switchNamed('notifications.doctor')).toBeChecked();
    expect(switchNamed('notifications.standing')).toBeChecked();
    expect(switchNamed('notifications.retest')).toBeChecked();
    expect(screen.getByText('9:00 PM')).toBeOnTheScreen();
    expect(screen.getByText('7:00 AM')).toBeOnTheScreen();
    expect(screen.getByText(en['notifications.limit'])).toBeOnTheScreen();
  });

  it.each([
    ['notifications.daily', 'daily', true],
    ['notifications.followUp', 'confirmation', false],
    ['notifications.doctor', 'doctor-followup', false],
    ['notifications.standing', 'standing', false],
    ['notifications.retest', 'retest', false],
  ] as const)('%s saves the %s field and syncs once', async (key, field, turnedOn) => {
    await open();
    fireEvent.press(switchNamed(key));
    await act(async () => undefined);
    expect(loadNotificationPrefs().enabled[field]).toBe(turnedOn);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0]?.[0].prefs.enabled[field]).toBe(turnedOn);
    expect(switchNamed(key).props.accessibilityState.checked).toBe(turnedOn);
  });

  it('asks for permission the first time a reminder is turned on', async () => {
    permissionNow.mockResolvedValue(answer('undetermined'));
    permissionAsk.mockResolvedValue(answer('granted'));
    await open();
    fireEvent.press(switchNamed('notifications.daily'));
    await act(async () => undefined);
    expect(permissionAsk).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0]?.[0].prefs.enabled.daily).toBe(true);
    expect(screen.queryByText(en['notifications.denied'])).toBeNull();
  });

  it('does not ask when permission is already granted', async () => {
    await open();
    fireEvent.press(switchNamed('notifications.daily'));
    await act(async () => undefined);
    expect(permissionAsk).not.toHaveBeenCalled();
  });

  it('shows the banner and every switch off when permission is refused, and keeps the choice', async () => {
    permissionNow.mockResolvedValue(answer('undetermined'));
    permissionAsk.mockResolvedValue(answer('denied'));
    await open();
    fireEvent.press(switchNamed('notifications.daily'));
    await act(async () => undefined);
    expect(screen.getByText(en['notifications.denied'])).toBeOnTheScreen();
    expect(switchNamed('notifications.daily')).not.toBeChecked();
    expect(switchNamed('notifications.followUp')).not.toBeChecked();
    expect(loadNotificationPrefs().enabled.daily).toBe(true);
    expect(sync.mock.calls[0]?.[0].prefs.enabled).toEqual({
      daily: false,
      confirmation: false,
      'doctor-followup': false,
      standing: false,
      retest: false,
    });
  });

  it('opens the phone settings from the banner', async () => {
    permissionNow.mockResolvedValue(answer('denied'));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await open();
    fireEvent.press(await screen.findByRole('button', { name: en['notifications.openSettings'] }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('stores the hide-values choice in the preferences', async () => {
    await open();
    fireEvent.press(switchNamed('notifications.hideValues'));
    expect(switchNamed('notifications.hideValues')).toBeChecked();
  });
});
