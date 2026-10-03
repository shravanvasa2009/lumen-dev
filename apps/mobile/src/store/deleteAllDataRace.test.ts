import type { NotificationRequestInput } from 'expo-notifications';
import { setNotificationChannelAsync } from 'expo-notifications';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import type { NotificationPrefs } from '@/notifications/plan';
import { syncNotifications } from '@/notifications/scheduler';
import { memoryFiles } from '@/testing/memoryFiles';

import { deleteAllData } from './deleteAllData';

jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);

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
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {
    mockPending.clear();
  }),
  scheduleNotificationAsync: jest.fn(async (request: NotificationRequestInput) => {
    const identifier = request.identifier ?? `system-${mockPending.size}`;
    mockPending.set(identifier, request);
    return identifier;
  }),
}));

const ALL_ON: NotificationPrefs = {
  enabled: { daily: true, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
  dailyTime: { hour: 8, minute: 0 },
  quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
};

beforeEach(() => {
  emptyMockDatabases();
  mockPending.clear();
  memoryFiles.clear();
});

describe('deleteAllData while a notification sync is running', () => {
  it('lets the running sync finish, then leaves nothing scheduled and no schedule file', async () => {
    let releaseSync: () => void = () => undefined;
    jest.mocked(setNotificationChannelAsync).mockImplementationOnce(
      () => new Promise((resolve) => (releaseSync = () => resolve(null))),
    );
    const running = syncNotifications(
      {
        prefs: ALL_ON,
        triggers: {
          confirmationFor: null,
          doctorFollowupFor: null,
          standingStartedAt: null,
          lastPhoneCheckAt: null,
        },
        timeZone: 'America/Chicago',
      },
      'en',
      () => Date.parse('2026-10-05T10:00:00-05:00'),
    );
    const deleting = deleteAllData('en');
    // Let the delete reach the queue, then let the running sync write its schedule and files.
    await Promise.resolve();
    releaseSync();
    await Promise.all([running, deleting]);

    expect([...mockPending.keys()]).toEqual([]);
    expect([...memoryFiles.keys()]).toEqual([]);
  });
});
