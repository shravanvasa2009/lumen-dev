import { requestPermissionsAsync } from 'expo-notifications';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { memoryFiles, mockFileSystem } from '@/testing/memoryFiles';
import { loadNotificationPrefs } from '@/notifications/prefs';
import { syncNotifications } from '@/notifications/scheduler';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock('expo-file-system', () => mockFileSystem);
jest.mock('@/notifications/scheduler', () => ({ syncNotifications: jest.fn(async () => undefined) }));
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));

fixClockAtMorning();

const askPermission = jest.mocked(requestPermissionsAsync);
const sync = jest.mocked(syncNotifications);

// The first render of the router compiles every route, which is slow on a busy machine.
jest.setTimeout(30_000);

preloadAppRoutes();

describe('reminders', () => {
  beforeEach(() => {
    askPermission.mockReset();
    sync.mockClear();
    memoryFiles.clear();
  });

  // Spec §8.2 step 9: the daily check stays off until the person turns it on.
  it('starts at 8:00 AM with the daily check off and follow-ups on', () => {
    renderRouter('./app', { initialUrl: '/reminders' });
    expect(screen.getByLabelText(/8:00/)).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: en['notifications.daily'] })).not.toBeChecked();
    for (const key of ['notifications.followUp', 'notifications.doctor'] as const)
      expect(screen.getByRole('switch', { name: en[key] })).toBeChecked();
    expect(screen.getByText(en['reminders.localOnly'])).toBeOnTheScreen();
  });

  it('shows the neighbouring times without AM or PM, as in the mockup', () => {
    renderRouter('./app', { initialUrl: '/reminders' });
    expect(screen.getByText('7:00')).toBeOnTheScreen();
    expect(screen.getByText('9:00')).toBeOnTheScreen();
    expect(screen.getByText('8:00 AM')).toBeOnTheScreen();
  });

  it('moves the time an hour at a time and wraps past midnight', () => {
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: /^One hour later/ }));
    expect(screen.getByLabelText(/Reminder time, 9:00/)).toBeOnTheScreen();
    for (let step = 0; step < 9; step += 1)
      fireEvent.press(screen.getByRole('button', { name: /^One hour later/ }));
    expect(screen.getByLabelText(/Reminder time, 6:00/)).toBeOnTheScreen();
    for (let step = 0; step < 7; step += 1)
      fireEvent.press(screen.getByRole('button', { name: /^One hour earlier/ }));
    expect(screen.getByLabelText(/Reminder time, 11:00/)).toBeOnTheScreen();
  });

  it('asks for notification permission, then opens Home', async () => {
    askPermission.mockResolvedValue({ granted: true } as Awaited<ReturnType<typeof requestPermissionsAsync>>);
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.turnOn'] }));
    expect(await screen.findByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
    expect(askPermission).toHaveBeenCalledTimes(1);
  });

  it('turns the daily check on at the chosen time and schedules once permission is granted', async () => {
    askPermission.mockResolvedValue({ granted: true, status: 'granted' } as Awaited<
      ReturnType<typeof requestPermissionsAsync>
    >);
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: /^One hour later/ }));
    fireEvent.press(screen.getByRole('switch', { name: en['notifications.doctor'] }));
    fireEvent.press(screen.getByRole('button', { name: en['reminders.turnOn'] }));
    await screen.findByRole('header', { name: en['home.greetingMorning'] });
    const saved = loadNotificationPrefs();
    expect(saved.enabled).toMatchObject({ daily: true, confirmation: true, 'doctor-followup': false });
    expect(saved.dailyTime).toEqual({ hour: 9, minute: 0 });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls[0]?.[0].prefs.enabled.daily).toBe(true);
  });

  it('keeps the choice but schedules nothing when permission is refused', async () => {
    askPermission.mockResolvedValue({ granted: false, status: 'denied' } as Awaited<
      ReturnType<typeof requestPermissionsAsync>
    >);
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.turnOn'] }));
    await screen.findByRole('header', { name: en['home.greetingMorning'] });
    expect(loadNotificationPrefs().enabled.daily).toBe(true);
    expect(sync.mock.calls[0]?.[0].prefs.enabled.daily).toBe(false);
  });

  it('still opens Home when the permission request fails, and reports the failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    askPermission.mockRejectedValue(new Error('no permission module'));
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.turnOn'] }));
    expect(await screen.findByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no permission module'));
    warn.mockRestore();
  });

  it('skips the permission request on Not now', () => {
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.notNow'] }));
    expect(screen.getByRole('header', { name: en['home.greetingMorning'] })).toBeOnTheScreen();
    expect(askPermission).not.toHaveBeenCalled();
  });
});
