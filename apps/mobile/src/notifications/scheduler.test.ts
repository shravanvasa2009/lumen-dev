import {
  cancelScheduledNotificationAsync,
  type NotificationRequestInput,
  SchedulableTriggerInputTypes,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
} from 'expo-notifications';

import copy from '../i18n/lockscreen.json';
import type { NotificationPrefs, NotificationTriggers, PlanRequest } from './plan';
import { syncNotifications } from './scheduler';

// The system's pending requests, keyed by identifier, as the native side keeps them.
const mockPending = new Map<string, NotificationRequestInput>();

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  setNotificationChannelAsync: jest.fn(async () => null),
  getAllScheduledNotificationsAsync: jest.fn(async () =>
    [...mockPending.entries()].map(([identifier, request]) => ({ ...request, identifier })),
  ),
  cancelScheduledNotificationAsync: jest.fn(async (identifier: string) => {
    mockPending.delete(identifier);
  }),
  scheduleNotificationAsync: jest.fn(async (request: NotificationRequestInput) => {
    const identifier = request.identifier ?? `system-${mockPending.size}`;
    mockPending.set(identifier, request);
    return identifier;
  }),
}));

const at = (iso: string) => Date.parse(iso);
const NOW = '2026-10-05T10:00:00-05:00';

const ALL_ON: NotificationPrefs = {
  enabled: { daily: true, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
  dailyTime: { hour: 8, minute: 0 },
  quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
};

const BUSY: NotificationTriggers = {
  confirmationFor: { readingId: 'reading-1', takenAt: at('2026-10-05T09:30:00-05:00') },
  doctorFollowupFor: { readingId: 'reading-0', takenAt: at('2026-10-01T09:00:00-05:00') },
  standingStartedAt: at(NOW),
  lastPhoneCheckAt: at('2026-09-20T12:00:00-05:00'),
};

const request = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  prefs: ALL_ON,
  triggers: BUSY,
  now: at(NOW),
  timeZone: 'America/Chicago',
  ...overrides,
});

const pendingIds = () => [...mockPending.keys()];
const pendingOfPrefix = (prefix: string) => pendingIds().filter((id) => id.startsWith(`${prefix}-`));

beforeEach(() => {
  mockPending.clear();
  jest.clearAllMocks();
});

describe('syncNotifications', () => {
  it('schedules every type with a date trigger, its channel, and its route', async () => {
    await syncNotifications(request(), 'en');
    expect(pendingIds()).toEqual(
      expect.arrayContaining([
        'confirm-2026-10-05T13:30',
        'confirm-2026-10-06T08:00',
        'doctor-2026-10-08T09:00',
        'retest-2026-10-20T12:00',
        'standing-2026-10-05T10:06',
        'daily-2026-10-06T08:00',
      ]),
    );
    const confirmation = mockPending.get('confirm-2026-10-05T13:30');
    expect(confirmation?.content.body).toBe(copy.en['notif.confirm']);
    expect(confirmation?.content.data).toEqual({ url: 'lumen://check?mode=full' });
    expect(confirmation?.trigger).toEqual({
      type: SchedulableTriggerInputTypes.DATE,
      date: at('2026-10-05T13:30:00-05:00'),
      channelId: 'reminders',
    });
    expect(mockPending.get('standing-2026-10-05T10:06')?.trigger).toEqual({
      type: SchedulableTriggerInputTypes.DATE,
      date: at('2026-10-05T10:06:00-05:00'),
      channelId: 'standing',
    });
    expect(mockPending.get('doctor-2026-10-08T09:00')?.content.data).toEqual({ url: '/follow-up' });
  });

  it('creates the reminders and standing-test channels with lock-screen copy', async () => {
    await syncNotifications(request(), 'es-MX');
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'reminders',
      expect.objectContaining({ name: copy.es['channel.reminders'] }),
    );
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'standing',
      expect.objectContaining({ name: copy.es['channel.standing'] }),
    );
  });

  it('shows only lock-screen copy, in the chosen language', async () => {
    for (const [language, strings] of Object.entries(copy)) {
      mockPending.clear();
      await syncNotifications(request(), language);
      const allowed = new Set(Object.values(strings));
      const shown = [...mockPending.values()].flatMap(({ content }) => [
        content.title,
        content.subtitle,
        content.body,
      ]);
      expect(shown.filter((text) => text != null && !allowed.has(text))).toEqual([]);
      expect(shown.filter((text) => text != null).length).toBe(mockPending.size);
    }
  });

  it('cancels a type when it is turned off', async () => {
    await syncNotifications(request(), 'en');
    expect(pendingOfPrefix('confirm')).toHaveLength(2);
    await syncNotifications(
      request({ prefs: { ...ALL_ON, enabled: { ...ALL_ON.enabled, confirmation: false } } }),
      'en',
    );
    expect(pendingOfPrefix('confirm')).toEqual([]);
    expect(pendingOfPrefix('doctor')).toHaveLength(1);
  });

  it('cancels the standing-test alerts when the test stops', async () => {
    await syncNotifications(request(), 'en');
    expect(pendingOfPrefix('standing')).toHaveLength(4);
    await syncNotifications(
      request({ triggers: { ...BUSY, standingStartedAt: null }, now: at('2026-10-05T10:07:00-05:00') }),
      'en',
    );
    expect(pendingOfPrefix('standing')).toEqual([]);
    expect(pendingOfPrefix('daily').length).toBeGreaterThan(0);
  });

  it('cancels only Lumen requests', async () => {
    mockPending.set('8c0f-system-request', { content: { body: 'other' }, trigger: null });
    await syncNotifications(
      request({ prefs: { ...ALL_ON, enabled: { ...ALL_ON.enabled, daily: false } } }),
      'en',
    );
    expect(cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('8c0f-system-request');
    expect(mockPending.has('8c0f-system-request')).toBe(true);
  });

  it('applies overlapping syncs in order, so the last settings win', async () => {
    const turnedOff = request({ prefs: { ...ALL_ON, enabled: { ...ALL_ON.enabled, daily: false } } });
    await Promise.all([syncNotifications(request(), 'en'), syncNotifications(turnedOff, 'en')]);
    expect(pendingOfPrefix('daily')).toEqual([]);
  });

  it('reports a failed schedule to the caller and still runs the next sync', async () => {
    jest.mocked(scheduleNotificationAsync).mockRejectedValueOnce(new Error('scheduling refused'));
    await expect(syncNotifications(request(), 'en')).rejects.toThrow('scheduling refused');
    await syncNotifications(request(), 'en');
    expect(pendingOfPrefix('daily').length).toBeGreaterThan(0);
  });
});
