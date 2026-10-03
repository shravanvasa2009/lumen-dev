import type { ModelOutputs, ReadingContext } from '@lumen/core';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { makeReading } from '@/testing/reading';

import { lumenDatabase } from './database';
import { loadProfile, profileValue, saveHealthNote, setProfileValue } from './profile';
import { listReadings, saveReading, storedReadingById } from './readings';

const CONTEXT: ReadingContext = {
  captureFps: 60,
  tier: null,
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};
const MODELS: ModelOutputs = { rhythm: null, diabetes: null };

function savedAt(createdAt: number, mode: 'quick' | 'full' = 'full') {
  return {
    id: `reading-${createdAt}`,
    createdAt,
    mode,
    context: CONTEXT,
    results: makeReading(createdAt, 64, 48).outcome,
    models: MODELS,
  };
}

beforeEach(emptyMockDatabases);

describe('the schema', () => {
  it('creates the four Appendix B tables and records its version', async () => {
    const database = await lumenDatabase();
    const tables = await database.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map(({ name }) => name)).toEqual(['baselines', 'device_rating', 'profile', 'readings']);
    expect(await database.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 1 });
  });

  it('refuses a database written by a newer version and leaves its tables alone', async () => {
    await jest.isolateModulesAsync(async () => {
      const { openDatabaseAsync } = await import('expo-sqlite');
      const newer = await openDatabaseAsync('lumen.db');
      await newer.execAsync('PRAGMA user_version = 2');
      const { lumenDatabase: openNewer } = await import('./database');
      await expect(openNewer()).rejects.toThrow(/schema version 2, newer than this app's 1/);
      await expect(openNewer()).rejects.toThrow(/newer/);
      expect(await newer.getAllAsync("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([]);
    });
  });

  it('opens once and shares the connection', async () => {
    expect(await lumenDatabase()).toBe(await lumenDatabase());
  });
});

describe('readings', () => {
  it('saves a reading and reads it back by id, with the results JSON intact', async () => {
    const reading = savedAt(1_700_000_000_000);
    await saveReading(reading);
    expect(await storedReadingById(reading.id)).toEqual({
      id: reading.id,
      takenAt: reading.createdAt,
      mode: 'full',
      outcome: reading.results,
    });
  });

  it('keeps the context and models JSON and marks the row as not demo', async () => {
    await saveReading(savedAt(1_700_000_000_000));
    const database = await lumenDatabase();
    const row = await database.getFirstAsync<{ context_json: string; models_json: string; demo: number }>(
      'SELECT context_json, models_json, demo FROM readings',
    );
    expect(JSON.parse(row?.context_json ?? 'null')).toEqual(CONTEXT);
    expect(JSON.parse(row?.models_json ?? 'null')).toEqual(MODELS);
    expect(row?.demo).toBe(0);
  });

  it('lists readings newest first', async () => {
    await saveReading(savedAt(2_000, 'quick'));
    await saveReading(savedAt(3_000));
    await saveReading(savedAt(1_000));
    const listed = await listReadings();
    expect(listed.map(({ takenAt }) => takenAt)).toEqual([3_000, 2_000, 1_000]);
    expect(listed.map(({ mode }) => mode)).toEqual(['full', 'quick', 'full']);
  });

  it('has no reading for an unknown id and none listed when nothing was saved', async () => {
    expect(await storedReadingById('reading-1')).toBeNull();
    expect(await listReadings()).toEqual([]);
  });

  it('refuses a second reading with the same id', async () => {
    await saveReading(savedAt(1_000));
    await expect(saveReading(savedAt(1_000))).rejects.toThrow(/UNIQUE|constraint/i);
  });
});

describe('profile', () => {
  it('returns null for a key never set, then the value, then the latest value', async () => {
    expect(await profileValue('athlete')).toBeNull();
    await setProfileValue('athlete', 'true');
    expect(await profileValue('athlete')).toBe('true');
    await setProfileValue('athlete', 'false');
    expect(await profileValue('athlete')).toBe('false');
  });
});

describe('health notes', () => {
  it('assumes no condition until one is answered', async () => {
    expect(await loadProfile()).toEqual({
      athlete: false,
      betaBlocker: false,
      pacemaker: false,
      knownAf: false,
    });
  });

  it('keeps each answer and the latest change to it', async () => {
    await saveHealthNote('pacemaker', true);
    await saveHealthNote('athlete', true);
    await saveHealthNote('athlete', false);
    expect(await loadProfile()).toEqual({
      athlete: false,
      betaBlocker: false,
      pacemaker: true,
      knownAf: false,
    });
  });
});
