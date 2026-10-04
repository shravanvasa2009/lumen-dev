import { act, renderHook } from '@testing-library/react-native';
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications';

import '@/i18n';
import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { demoReadingById, keepDemoReading } from '@/demo/demoReadings';
import { enterDemo, isDemoActive } from '@/demo/demoSession';
import { pendingProgress } from '@/measure/analysisProgress';
import { keepCapture, keptCapture } from '@/measure/keptCapture';
import { syncNotifications } from '@/notifications/scheduler';
import { saveNotificationPrefs } from '@/notifications/prefs';
import { saveScheduleRecord } from '@/notifications/record';
import { finishOnboarding } from '@/profile/onboarding';
import { makeReading } from '@/testing/reading';
import { memoryFiles } from '@/testing/memoryFiles';
import { saveTestReading } from '@/testing/savedReading';
import { setPreference, usePreferences } from '@/theme/preferences';

import { LumenWidgets } from '../../modules/lumen-widgets/src';
import type { WidgetSnapshot } from '@/widgets/snapshot';

import { lumenDatabase } from './database';
import { deleteAllData } from './deleteAllData';
import { EMPTY_RISK_DRAFT } from '@/profile/diabetesRisk';

import { loadRiskDraft, profileValue, saveHealthNote, saveRiskDraft } from './profile';
import { listReadings } from './readings';

jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn() }));
jest.mock('@/notifications/scheduler', () => ({ syncNotifications: jest.fn(async () => undefined) }));
jest.mock('../../modules/lumen-widgets/src', () => ({
  LumenWidgets: { publishSnapshot: jest.fn(() => Promise.resolve()) },
}));

const cancelAll = jest.mocked(cancelAllScheduledNotificationsAsync);
const sync = jest.mocked(syncNotifications);

const EMPTY = { baselines: 0, device_rating: 0, profile: 0, readings: 0 };

async function rowCounts(): Promise<Record<string, number>> {
  const database = await lumenDatabase();
  const tables = await database.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const row = await database.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name}"`);
    counts[name] = row?.n ?? 0;
  }
  return counts;
}

async function fillEveryTable(): Promise<void> {
  await saveTestReading(Date.UTC(2026, 9, 1), 70);
  await finishOnboarding();
  await saveHealthNote('athlete', true);
  const database = await lumenDatabase();
  await database.runAsync(
    'INSERT INTO baselines (metric, computed_at, median, iqr, n) VALUES (?, ?, ?, ?, ?)',
    ['hr', 1, 64, 4, 7],
  );
  await database.runAsync('INSERT INTO device_rating (id, tested_at, score, tier) VALUES (1, 1, 80, ?)', [
    'full',
  ]);
}

beforeEach(() => {
  emptyMockDatabases();
  memoryFiles.clear();
  cancelAll.mockReset();
  cancelAll.mockResolvedValue(undefined);
  jest.mocked(LumenWidgets!.publishSnapshot).mockClear();
  sync.mockReset();
  sync.mockResolvedValue(undefined);
});

describe('deleteAllData', () => {
  it('replaces the home-screen widget snapshot with the no-reading one (PRIV-1)', async () => {
    await saveTestReading(Date.UTC(2026, 9, 1), 70);
    await deleteAllData('en');
    const calls = jest.mocked(LumenWidgets!.publishSnapshot).mock.calls;
    expect(calls).toHaveLength(1);
    const snapshot = JSON.parse(calls[0]![0]) as WidgetSnapshot;
    expect(snapshot.status).toBeNull();
    expect(snapshot.hrBpm).toBeNull();
    expect(snapshot.lastReadingAt).toBeNull();
  });

  it('empties readings, profile, baselines and device rating', async () => {
    await fillEveryTable();
    expect(Object.values(await rowCounts()).every((count) => count > 0)).toBe(true);
    await deleteAllData('en');
    expect(await rowCounts()).toEqual(EMPTY);
    expect(await listReadings()).toEqual([]);
  });

  it('resets the onboarding gate and the health notes', async () => {
    await fillEveryTable();
    expect(await profileValue('onboardingDone')).toBe('true');
    await deleteAllData('en');
    expect(await profileValue('onboardingDone')).toBeNull();
    expect(await profileValue('athlete')).toBeNull();
  });

  it('removes the diabetes risk answers, height, weight, age and sex', async () => {
    await saveRiskDraft({
      ageYears: 52,
      sex: 'female',
      heightCm: 168,
      weightKg: 82,
      familyHistory: true,
      hypertension: false,
      physicallyActive: true,
      gestationalDiabetes: false,
    });
    expect((await loadRiskDraft()).heightCm).toBe(168);
    await deleteAllData('en');
    expect(await loadRiskDraft()).toEqual(EMPTY_RISK_DRAFT);
    expect(await profileValue('weightKg')).toBeNull();
  });

  it('cancels every scheduled notification and removes the settings and schedule files', async () => {
    saveNotificationPrefs({
      enabled: { daily: true, confirmation: true, 'doctor-followup': true, standing: true, retest: true },
      dailyTime: { hour: 7, minute: 30 },
      quietHours: { start: { hour: 22, minute: 0 }, end: { hour: 6, minute: 0 } },
    });
    saveScheduleRecord([
      {
        id: 'daily-1',
        type: 'daily',
        fireAt: new Date(2026, 9, 2, 8, 0).toISOString(),
        route: '/measure/mode',
        createdFor: 'daily',
      },
    ]);
    expect(memoryFiles.size).toBe(2);
    await deleteAllData('en');
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect([...memoryFiles.keys()]).toEqual([]);
  });

  it('clears the capture, demo readings, demo session and preferences held in memory', async () => {
    keepCapture({
      captureFps: 30,
      lensId: null,
      samples: [],
      stats: [],
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
    });
    const demoId = keepDemoReading(
      {
        readingId: 'unused',
        urgent: null,
        recordedMs: 5,
        context: {
          captureFps: 30,
          tier: null,
          mode: 'quick',
          restTimerDone: true,
          recordedAt: null,
          motionSpans: [],
          coldHandsSpans: [],
          sqi: null,
          validationRhythmLabel: null,
        },
        models: { rhythm: null, diabetes: null },
        reading: makeReading(5, 60, null).outcome,
        progress: pendingProgress,
      },
      'quick',
    );
    enterDemo();
    setPreference('appearance', 'dark');
    setPreference('hideWidgetValues', true);
    const preferences = renderHook(usePreferences);
    await act(() => deleteAllData('en'));
    expect(keptCapture()).toBeNull();
    expect(demoReadingById(demoId)).toBeUndefined();
    expect(isDemoActive()).toBe(false);
    expect(preferences.result.current).toEqual({ appearance: 'system', hideWidgetValues: false });
  });

  it('throws when reminders cannot be cancelled, and leaves the data alone', async () => {
    await fillEveryTable();
    cancelAll.mockRejectedValue(new Error('scheduler unavailable'));
    await expect(deleteAllData('en')).rejects.toThrow('scheduler unavailable');
    expect((await rowCounts()).readings).toBe(1);
  });

  it('can be run again after a failure and then finishes the job', async () => {
    await fillEveryTable();
    cancelAll.mockRejectedValueOnce(new Error('scheduler unavailable'));
    await expect(deleteAllData('en')).rejects.toThrow();
    await deleteAllData('en');
    expect(await rowCounts()).toEqual(EMPTY);
  });

  it('syncs with every reminder off before it cancels or deletes anything', async () => {
    await fillEveryTable();
    const order: string[] = [];
    sync.mockImplementation(async () => {
      order.push('sync');
      expect((await rowCounts()).readings).toBe(1);
    });
    cancelAll.mockImplementation(async () => {
      order.push('cancel');
    });
    await deleteAllData('es');
    expect(order).toEqual(['sync', 'cancel']);
    const [request, language] = sync.mock.calls[0]!;
    expect(Object.values(request.prefs.enabled)).toEqual([false, false, false, false, false]);
    expect(request.triggers).toEqual({
      confirmationFor: null,
      doctorFollowupFor: null,
      standingStartedAt: null,
      lastPhoneCheckAt: null,
    });
    expect(language).toBe('es');
  });

  it('stops without deleting when the sync fails', async () => {
    await fillEveryTable();
    sync.mockRejectedValue(new Error('sync failed'));
    await expect(deleteAllData('en')).rejects.toThrow('sync failed');
    expect(cancelAll).not.toHaveBeenCalled();
    expect((await rowCounts()).readings).toBe(1);
  });

  it('removes the folder expo-print writes PDFs to, and leaves other cache files', async () => {
    memoryFiles.set('cache/Print/a.pdf', 'x');
    memoryFiles.set('cache/Print/b.pdf', 'x');
    memoryFiles.set('cache/other.bin', 'x');
    await deleteAllData('en');
    expect([...memoryFiles.keys()]).toEqual(['cache/other.bin']);
  });

  it('removes a readings export left behind when the app closed during sharing', async () => {
    memoryFiles.set('lumen-readings.csv', 'taken_at_utc,mode');
    memoryFiles.set('cache/other.bin', 'x');
    await deleteAllData('en');
    expect([...memoryFiles.keys()]).toEqual(['cache/other.bin']);
  });

  it('turns secure_delete on before the deletes and vacuums after them', async () => {
    await fillEveryTable();
    const database = await lumenDatabase();
    const issued: string[] = [];
    const exec = database.execAsync.bind(database);
    const run = database.runAsync.bind(database);
    jest.spyOn(database, 'execAsync').mockImplementation(async (statement) => {
      issued.push(statement);
      await exec(statement);
    });
    jest.spyOn(database, 'runAsync').mockImplementation(async (statement, ...params) => {
      if (statement.startsWith('DELETE')) issued.push('DELETE');
      return run(statement, ...params);
    });
    await deleteAllData('en');
    expect(issued[0]).toBe('PRAGMA secure_delete = ON');
    expect(issued.at(-1)).toBe('VACUUM');
    expect(issued.filter((statement) => statement === 'DELETE')).toHaveLength(4);
    jest.restoreAllMocks();
  });
});
