import { rateDevice, type ReadingContext } from '@lumen/core';
import { getPermissionsAsync, scheduleNotificationAsync } from 'expo-notifications';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import '@/i18n';
import type { StoredReading } from '@/home/readings';
import type { NotificationPrefs } from '@/notifications/plan';
import { saveNotificationPrefs } from '@/notifications/prefs';
import { saveFollowUpAnswer } from '@/profile/followUp';
import { saveDeviceRating } from '@/store/deviceRating';
import { saveReading } from '@/store/readings';
import { memoryFiles } from '@/testing/memoryFiles';
import { makeReading } from '@/testing/reading';

import { resyncNotifications } from './applyPrefs';

jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled'),
}));

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 5, 12, 0).getTime();
const CONTEXT: ReadingContext = {
  captureFps: 60,
  tier: null,
  mode: 'quick',
  restTimerDone: false,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};

const PREFS: NotificationPrefs = {
  enabled: { daily: false, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
  dailyTime: { hour: 8, minute: 0 },
  quietHours: { start: { hour: 21, minute: 0 }, end: { hour: 7, minute: 0 } },
};

const answerOf = (status: 'granted' | 'denied') =>
  ({ status, granted: status === 'granted', canAskAgain: status !== 'denied' }) as Awaited<
    ReturnType<typeof getPermissionsAsync>
  >;

function flaggedReading(takenAt: number): StoredReading {
  const reading = makeReading(takenAt, 70, 40);
  reading.outcome.metrics.rhythm = {
    class: 'af',
    pAF: 0.9,
    evidence: 'public-data',
    confidence: 'high',
    quality: 'standard',
    qualityReasons: [],
    flag: 'possibleAf',
  };
  return { ...reading, mode: 'quick' };
}

async function store(reading: StoredReading) {
  await saveReading({
    id: reading.id,
    createdAt: reading.takenAt,
    mode: reading.mode ?? 'quick',
    context: CONTEXT,
    results: reading.outcome,
    models: { rhythm: null, diabetes: null },
  });
}

async function storeRating(testedAt: number) {
  await saveDeviceRating(
    rateDevice(
      {
        rearLenses: [{ id: 'main', maxFps: 30, torchUsable: true }],
        torch: { available: true },
        locks: { exposure: true, whiteBalance: true, focus: true },
      },
      {
        lensId: 'main',
        achievedFps: 30,
        frameIntervalSdMs: 0.5,
        coupling: { perfusionIndexPct: 1.2, snrDb: 14 },
      },
    ),
    { testedAt, osVersion: '26.0', appVersion: null, lensId: 'main', practice: null },
  );
}

// What the system was asked to schedule by one sync, as route and fire time.
async function scheduledByResync(): Promise<{ route: string; at: number }[]> {
  jest.mocked(scheduleNotificationAsync).mockClear();
  await resyncNotifications();
  return jest.mocked(scheduleNotificationAsync).mock.calls.map(([request]) => ({
    route: (request.content.data as { url: string }).url,
    at: (request.trigger as { date: number }).date,
  }));
}

const routesOf = async () => (await scheduledByResync()).map(({ route }) => route);
const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).getTime();

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  memoryFiles.clear();
  emptyMockDatabases();
  jest.mocked(getPermissionsAsync).mockResolvedValue(answerOf('granted'));
  saveNotificationPrefs(PREFS);
});

afterEach(() => jest.useRealTimers());

describe('reminders that follow a stored result', () => {
  it('plans a confirmation and a doctor follow-up for a flagged reading, at the right times', async () => {
    await store(flaggedReading(NOW - HOUR));
    expect(await scheduledByResync()).toEqual([
      { route: 'lumen://check?mode=full', at: NOW + 3 * HOUR },
      { route: 'lumen://check?mode=full', at: local(6, 8) },
      { route: '/follow-up', at: local(12, 11) },
    ]);
  });

  it('stops the doctor follow-up once the follow-up is answered "saw" after the flagged reading', async () => {
    await store(flaggedReading(NOW - HOUR));
    await saveFollowUpAnswer('saw', NOW);
    const routes = await routesOf();
    expect(routes).not.toContain('/follow-up');
    expect(routes).toContain('lumen://check?mode=full');
  });

  it.each(['booked', 'notYet'] as const)(
    'keeps the doctor follow-up after the answer "%s"',
    async (answer) => {
      await store(flaggedReading(NOW - HOUR));
      await saveFollowUpAnswer(answer, NOW);
      expect(await routesOf()).toContain('/follow-up');
    },
  );

  it('drops the confirmation once a Full Check is taken after the flagged reading', async () => {
    await store(flaggedReading(NOW - 2 * HOUR));
    await store({ ...makeReading(NOW - HOUR, 64, 40), mode: 'full' });
    const routes = await routesOf();
    expect(routes).not.toContain('lumen://check?mode=full');
    expect(routes).toContain('/follow-up');
  });

  it('keeps the confirmation when the later Full Check was inconclusive or could not tell', async () => {
    await store(flaggedReading(NOW - 3 * HOUR));
    const inconclusive = makeReading(NOW - 2 * HOUR, null, null);
    inconclusive.outcome.headlineKey = 'result.inconclusive';
    await store({ ...inconclusive, mode: 'full' });
    const uncertain = makeReading(NOW - HOUR, 64, 40);
    uncertain.outcome.headlineKey = 'result.uncertain';
    await store({ ...uncertain, mode: 'full' });
    expect(await routesOf()).toContain('lumen://check?mode=full');
  });

  it('keeps the confirmation when the later Full Check judged no rhythm', async () => {
    await store(flaggedReading(NOW - 2 * HOUR));
    const hrOnly = makeReading(NOW - HOUR, 64, null);
    hrOnly.outcome.headlineKey = 'result.hrOnly';
    await store({ ...hrOnly, mode: 'full' });
    expect(await routesOf()).toContain('lumen://check?mode=full');
  });

  it('keeps the confirmation when the later regular Full Check was lower quality (ADR 0104)', async () => {
    await store(flaggedReading(NOW - 2 * HOUR));
    const low = makeReading(NOW - HOUR, 64, 40);
    low.outcome.quality = { level: 'low', reasons: [{ kind: 'shortClean', haveS: 40, wantS: 90 }] };
    await store({ ...low, mode: 'full' });
    expect(await routesOf()).toContain('lumen://check?mode=full');
  });

  it('plans nothing for a heart-rate-only reading with no flag', async () => {
    const hrOnly = makeReading(NOW - HOUR, 64, null);
    hrOnly.outcome.headlineKey = 'result.hrOnly';
    await store({ ...hrOnly, mode: 'quick' });
    expect(await scheduledByResync()).toEqual([]);
  });

  it('plans no confirmation for a could-not-tell reading, which asks for an immediate retake', async () => {
    const uncertain = makeReading(NOW - HOUR, 64, 40);
    uncertain.outcome.headlineKey = 'result.uncertain';
    await store({ ...uncertain, mode: 'quick' });
    expect(await scheduledByResync()).toEqual([]);
  });

  it('plans nothing for an inconclusive reading', async () => {
    const inconclusive = makeReading(NOW - HOUR, null, null);
    inconclusive.outcome.headlineKey = 'result.inconclusive';
    await store({ ...inconclusive, mode: 'quick' });
    expect(await scheduledByResync()).toEqual([]);
  });

  it('plans nothing for a regular reading', async () => {
    await store({ ...makeReading(NOW - HOUR, 64, 40), mode: 'quick' });
    expect(await scheduledByResync()).toEqual([]);
  });

  it('plans the phone re-test 30 days after the stored rating', async () => {
    await storeRating(NOW - HOUR);
    expect(await scheduledByResync()).toEqual([{ route: '/settings/phone', at: local(5 + 30, 11) }]);
  });

  it('plans nothing when every type is switched off', async () => {
    saveNotificationPrefs({
      ...PREFS,
      enabled: {
        daily: false,
        confirmation: false,
        'doctor-followup': false,
        standing: false,
        retest: false,
      },
    });
    await store(flaggedReading(NOW - HOUR));
    await storeRating(NOW - HOUR);
    expect(await scheduledByResync()).toEqual([]);
  });

  it('plans nothing when notification permission is denied', async () => {
    jest.mocked(getPermissionsAsync).mockResolvedValue(answerOf('denied'));
    await store(flaggedReading(NOW - HOUR));
    await storeRating(NOW - HOUR);
    expect(await scheduledByResync()).toEqual([]);
  });

  it('warns and resolves false when the sync fails, so the app stays usable', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.mocked(getPermissionsAsync).mockRejectedValue(new Error('no permission service'));
    expect(await resyncNotifications()).toBe(false);
    expect(warning).toHaveBeenCalledWith('Reminders could not be updated: no permission service');
    warning.mockRestore();
  });
});
