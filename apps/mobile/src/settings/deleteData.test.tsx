import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { listReadings } from '@/store/readings';
import { memoryFiles } from '@/testing/memoryFiles';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { saveTestReading } from '@/testing/savedReading';
import { saveNotificationPrefs } from '@/notifications/prefs';
import { profileValue } from '@/store/profile';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));
jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  cancelAllScheduledNotificationsAsync: jest.fn(),
}));

const cancelAll = jest.mocked(cancelAllScheduledNotificationsAsync);

preloadAppRoutes();

const deleteRow = () => screen.getByRole('button', { name: new RegExp(en['settings.delete']) });
const confirmButton = () => screen.getByRole('button', { name: en['settings.deleteConfirm'] });

beforeEach(async () => {
  await startOnboarded();
  memoryFiles.clear();
  cancelAll.mockReset();
  cancelAll.mockResolvedValue(undefined);
  await saveTestReading(new Date(2026, 9, 1, 7, 0).getTime(), 70);
  saveNotificationPrefs({
    enabled: { daily: true, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
    dailyTime: { hour: 7, minute: 0 },
    quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
  });
});

describe('Delete all data in Settings', () => {
  it('asks first, and changing your mind keeps everything', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    expect(screen.queryByText(en['settings.deleteConfirmTitle'])).toBeNull();
    fireEvent.press(deleteRow());
    expect(screen.getByText(en['settings.deleteConfirmTitle'])).toBeOnTheScreen();
    expect(screen.getByText(en['settings.deleteConfirmBody'])).toBeOnTheScreen();
    expect(deleteRow()).toBeExpanded();
    fireEvent.press(screen.getByRole('button', { name: en['settings.deleteCancel'] }));
    expect(screen.queryByText(en['settings.deleteConfirmTitle'])).toBeNull();
    expect(await listReadings()).toHaveLength(1);
    expect(cancelAll).not.toHaveBeenCalled();
    expect(memoryFiles.size).toBe(1);
  });

  it('deletes everything on confirm and returns to Welcome', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(deleteRow());
    fireEvent.press(confirmButton());
    expect(await screen.findByRole('button', { name: en['welcome.getStarted'] })).toBeOnTheScreen();
    expect(await listReadings()).toEqual([]);
    expect(await profileValue('onboardingDone')).toBeNull();
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(memoryFiles.size).toBe(0);
  });

  it('starts at Welcome again on the next launch', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(deleteRow());
    fireEvent.press(confirmButton());
    await screen.findByRole('button', { name: en['welcome.getStarted'] });
    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByRole('button', { name: en['welcome.getStarted'] })).toBeOnTheScreen();
  });

  it('says so when deleting fails, keeps the data, and works on a second try', async () => {
    cancelAll.mockRejectedValueOnce(new Error('scheduler unavailable'));
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(deleteRow());
    fireEvent.press(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(en['settings.deleteFailed']);
    expect(await listReadings()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: en['welcome.getStarted'] })).toBeNull();
    fireEvent.press(confirmButton());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: en['welcome.getStarted'] })).toBeOnTheScreen(),
    );
    expect(await listReadings()).toEqual([]);
  });

  it('has Spanish strings for every step', () => {
    for (const key of [
      'settings.deleteConfirmTitle',
      'settings.deleteConfirmBody',
      'settings.deleteConfirm',
      'settings.deleteCancel',
      'settings.deleting',
      'settings.deleteFailed',
    ] as const) {
      expect(es[key]).not.toBe(en[key]);
    }
  });
});
