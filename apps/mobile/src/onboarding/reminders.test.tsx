import { requestPermissionsAsync } from 'expo-notifications';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock('expo-notifications', () => ({ requestPermissionsAsync: jest.fn() }));

const askPermission = jest.mocked(requestPermissionsAsync);

// The first render of the router compiles every route, which is slow on a busy machine.
jest.setTimeout(30_000);

describe('reminders', () => {
  beforeEach(() => askPermission.mockReset());

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
    expect(await screen.findByRole('header', { name: en['tabs.home'] })).toBeOnTheScreen();
    expect(askPermission).toHaveBeenCalledTimes(1);
  });

  it('still opens Home when the permission request fails, and reports the failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    askPermission.mockRejectedValue(new Error('no permission module'));
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.turnOn'] }));
    expect(await screen.findByRole('header', { name: en['tabs.home'] })).toBeOnTheScreen();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no permission module'));
    warn.mockRestore();
  });

  it('skips the permission request on Not now', () => {
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.notNow'] }));
    expect(screen.getByRole('header', { name: en['tabs.home'] })).toBeOnTheScreen();
    expect(askPermission).not.toHaveBeenCalled();
  });
});
