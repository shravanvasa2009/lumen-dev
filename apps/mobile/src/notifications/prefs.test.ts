import { memoryFiles } from '@/testing/memoryFiles';

import { loadNotificationPrefs, saveNotificationPrefs } from './prefs';

jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').expoFileSystem);

beforeEach(() => memoryFiles.clear());

describe('notification prefs', () => {
  it('starts with the daily check off at 8:00, the rest on, and quiet hours 9:00 pm to 7:00 am', () => {
    expect(loadNotificationPrefs()).toEqual({
      enabled: { daily: false, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
      dailyTime: { hour: 8, minute: 0 },
      quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
    });
  });

  it('keeps what was saved', () => {
    const chosen = {
      enabled: { daily: true, confirmation: false, 'doctor-followup': true, standing: false, retest: true },
      dailyTime: { hour: 6, minute: 45 },
      quietHours: { start: { hour: 22, minute: 30 }, end: { hour: 6, minute: 0 } },
    };
    saveNotificationPrefs(chosen);
    expect(loadNotificationPrefs()).toEqual(chosen);
    saveNotificationPrefs({ ...chosen, dailyTime: { hour: 7, minute: 0 } });
    expect(loadNotificationPrefs().dailyTime).toEqual({ hour: 7, minute: 0 });
  });

  it('fills in fields an older or edited file lacks or holds wrongly', () => {
    memoryFiles.set(
      'notification-prefs.json',
      JSON.stringify({
        enabled: { daily: true, retest: 'yes' },
        dailyTime: { hour: 25, minute: 0 },
        quietHours: {},
      }),
    );
    expect(loadNotificationPrefs()).toEqual({
      enabled: { daily: true, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
      dailyTime: { hour: 8, minute: 0 },
      quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
    });
  });

  it('reports a damaged file and falls back to the defaults', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    memoryFiles.set('notification-prefs.json', '{"enabled":');
    expect(loadNotificationPrefs().enabled.daily).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Notification settings could not be read'));
    warn.mockRestore();
  });
});
