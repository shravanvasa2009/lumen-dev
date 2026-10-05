import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import i18next from 'i18next';
import { Linking } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import * as prefsStore from '@/notifications/prefs';
import { planNotifications } from '@/notifications/plan';
import { loadNotificationPrefs } from '@/notifications/prefs';
import { syncNotifications } from '@/notifications/scheduler';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { memoryFiles } from '@/testing/memoryFiles';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { setPreference } from '@/theme/preferences';

fixClockAtMorning();

jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);
// The native picker can't render in Jest; this stand-in passes a picked time through the same callback.
jest.mock('@expo/ui/community/datetime-picker', () => {
  const { View } = jest.requireActual('react-native');
  return { DateTimePicker: (props: object) => <View testID="time-picker" {...props} /> };
});
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
  // The app-start sync is not the one under test.
  await act(async () => undefined);
  sync.mockClear();
  permissionNow.mockClear();
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
    expect(switchNamed('notifications.daily')).toBeDisabled();
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

  it('flips the hide-values preference for this session', async () => {
    await open();
    fireEvent.press(switchNamed('notifications.hideValues'));
    expect(switchNamed('notifications.hideValues')).toBeChecked();
  });

  it('shows a message and puts the switch back when scheduling fails', async () => {
    await open();
    sync.mockRejectedValueOnce(new Error('scheduler down'));
    fireEvent.press(switchNamed('notifications.daily'));
    expect(await screen.findByText(en['notifications.updateFailed'])).toBeOnTheScreen();
    expect(switchNamed('notifications.daily')).not.toBeChecked();
    expect(loadNotificationPrefs().enabled.daily).toBe(false);
  });

  it('shows a message and puts the switch back when saving fails', async () => {
    await open();
    const save = jest.spyOn(prefsStore, 'saveNotificationPrefs').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    fireEvent.press(switchNamed('notifications.daily'));
    expect(await screen.findByText(en['notifications.updateFailed'])).toBeOnTheScreen();
    expect(switchNamed('notifications.daily')).not.toBeChecked();
    save.mockRestore();
  });

  it('shows a message when the permission request fails', async () => {
    permissionNow.mockResolvedValue(answer('undetermined'));
    permissionAsk.mockRejectedValue(new Error('no permission module'));
    await open();
    fireEvent.press(switchNamed('notifications.daily'));
    expect(await screen.findByText(en['notifications.updateFailed'])).toBeOnTheScreen();
    expect(switchNamed('notifications.daily')).not.toBeChecked();
  });

  it('shows a message when permission cannot be read on opening', async () => {
    permissionNow.mockRejectedValue(new Error('no permission module'));
    renderRouter(appDirectory, { initialUrl: '/settings/notifications' });
    expect(await screen.findByText(en['notifications.updateFailed'])).toBeOnTheScreen();
  });

  describe('times', () => {
    const pickTime = (hour: number, minute: number) =>
      act(async () => {
        fireEvent(screen.getByTestId('time-picker'), 'valueChange', {}, new Date(2000, 0, 1, hour, minute));
      });

    it('saves a new quiet-hours start and syncs once', async () => {
      await open();
      fireEvent.press(screen.getByRole('button', { name: en['notifications.from'] }));
      await pickTime(22, 30);
      expect(loadNotificationPrefs().quietHours.start).toEqual({ hour: 22, minute: 30 });
      expect(sync).toHaveBeenCalledTimes(1);
      expect(screen.getByText('10:30 PM')).toBeOnTheScreen();
    });

    it('shows the reminder time only while the daily check is on, and saves a new one', async () => {
      await open();
      expect(screen.queryByRole('button', { name: en['notifications.dailyTime'] })).toBeNull();
      fireEvent.press(switchNamed('notifications.daily'));
      await act(async () => undefined);
      fireEvent.press(screen.getByRole('button', { name: en['notifications.dailyTime'] }));
      await pickTime(9, 15);
      expect(loadNotificationPrefs().dailyTime).toEqual({ hour: 9, minute: 15 });
      expect(screen.getByText('9:15 AM')).toBeOnTheScreen();
    });

    // NOTIF-1: quiet hours that now cover 8:00 move the 8:00 daily reminder to their end.
    it('moves the daily reminder to the end of quiet hours that now cover it', async () => {
      await open();
      fireEvent.press(switchNamed('notifications.daily'));
      await act(async () => undefined);
      sync.mockClear();
      fireEvent.press(screen.getByRole('button', { name: en['notifications.until'] }));
      await pickTime(9, 0);
      const { prefs } = sync.mock.calls[0]![0];
      expect(prefs.quietHours.end).toEqual({ hour: 9, minute: 0 });
      const [first] = planNotifications({
        prefs,
        triggers: { confirmationFor: null, doctorFollowupFor: null, standingStartedAt: null, lastPhoneCheckAt: null },
        now: Date.parse('2026-10-05T05:00:00-05:00'),
        timeZone: 'America/Chicago',
        previousSchedule: [],
      });
      expect(first?.fireAt).toBe('2026-10-05T09:00:00-05:00');
    });

    it('shows a 12-hour dial in English, matching the rows', async () => {
      await open();
      fireEvent.press(screen.getByRole('button', { name: en['notifications.from'] }));
      expect(screen.getByTestId('time-picker').props.is24Hour).toBe(false);
    });

    it('shows a 24-hour dial and 24-hour rows in Spanish', async () => {
      await act(async () => {
        await i18next.changeLanguage('es');
      });
      try {
        renderRouter(appDirectory, { initialUrl: '/settings/notifications' });
        await screen.findByRole('switch', { name: es['notifications.daily'] });
        expect(screen.getByText('21:00')).toBeOnTheScreen();
        fireEvent.press(screen.getByRole('button', { name: es['notifications.from'] }));
        const picker = screen.getByTestId('time-picker');
        expect(picker.props.is24Hour).toBe(true);
        expect(picker.props.locale).toBe('es');
      } finally {
        await act(async () => {
          await i18next.changeLanguage('en');
        });
      }
    });

    it('closes the picker without saving when it is dismissed', async () => {
      await open();
      fireEvent.press(screen.getByRole('button', { name: en['notifications.until'] }));
      await act(async () => {
        fireEvent(screen.getByTestId('time-picker'), 'dismiss');
      });
      expect(screen.queryByTestId('time-picker')).toBeNull();
      expect(sync).not.toHaveBeenCalled();
    });
  });
});
