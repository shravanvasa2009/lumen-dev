import { act, renderHook } from '@testing-library/react-native';
import { cancelAllScheduledNotificationsAsync } from 'expo-notifications';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { demoReadingById, keepDemoReading } from '@/demo/demoReadings';
import { enterDemo, isDemoActive } from '@/demo/demoSession';
import { pendingProgress } from '@/measure/analysisProgress';
import { keepCapture, keptCapture } from '@/measure/keptCapture';
import { saveNotificationPrefs } from '@/notifications/prefs';
import { saveScheduleRecord } from '@/notifications/record';
import { finishOnboarding } from '@/profile/onboarding';
import { makeReading } from '@/testing/reading';
import { memoryFiles } from '@/testing/memoryFiles';
import { saveTestReading } from '@/testing/savedReading';
import { setPreference, usePreferences } from '@/theme/preferences';

import { lumenDatabase } from './database';
import { deleteAllData } from './deleteAllData';
import { profileValue, saveHealthNote } from './profile';
import { listReadings } from './readings';

jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);
jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn() }));

const cancelAll = jest.mocked(cancelAllScheduledNotificationsAsync);

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
});

describe('deleteAllData', () => {
  it('empties readings, profile, baselines and device rating', async () => {
    await fillEveryTable();
    expect(Object.values(await rowCounts()).every((count) => count > 0)).toBe(true);
    await deleteAllData();
    expect(await rowCounts()).toEqual(EMPTY);
    expect(await listReadings()).toEqual([]);
  });

  it('resets the onboarding gate and the health notes', async () => {
    await fillEveryTable();
    expect(await profileValue('onboardingDone')).toBe('true');
    await deleteAllData();
    expect(await profileValue('onboardingDone')).toBeNull();
    expect(await profileValue('athlete')).toBeNull();
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
    await deleteAllData();
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
    await act(deleteAllData);
    expect(keptCapture()).toBeNull();
    expect(demoReadingById(demoId)).toBeUndefined();
    expect(isDemoActive()).toBe(false);
    expect(preferences.result.current).toEqual({ appearance: 'system', hideWidgetValues: false });
  });

  it('throws when reminders cannot be cancelled, and leaves the data alone', async () => {
    await fillEveryTable();
    cancelAll.mockRejectedValue(new Error('scheduler unavailable'));
    await expect(deleteAllData()).rejects.toThrow('scheduler unavailable');
    expect((await rowCounts()).readings).toBe(1);
  });

  it('can be run again after a failure and then finishes the job', async () => {
    await fillEveryTable();
    cancelAll.mockRejectedValueOnce(new Error('scheduler unavailable'));
    await expect(deleteAllData()).rejects.toThrow();
    await deleteAllData();
    expect(await rowCounts()).toEqual(EMPTY);
  });
});
