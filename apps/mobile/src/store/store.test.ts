import type { ModelOutputs, ReadingContext } from '@lumen/core';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { makeReading } from '@/testing/reading';

import { lumenDatabase } from './database';
import { loadProfile, profileValue, saveHealthNote, setProfileValue } from './profile';
import { listReadings, pastReadings, saveReading, storedReadingById } from './readings';

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

  it('keeps which scorer gave the rhythm card, and reads an older reading without one', async () => {
    const byRule = {
      ...savedAt(2_000),
      models: { ...MODELS, rhythm: { windowProbs: [], tauAf: 0.6, scorer: 'rule' as const } },
    };
    await saveReading(byRule);
    const database = await lumenDatabase();
    const row = await database.getFirstAsync<{ models_json: string }>('SELECT models_json FROM readings');
    expect(JSON.parse(row?.models_json ?? 'null').rhythm.scorer).toBe('rule');
    // No scorer field: the saved result of an older reading reads back unchanged, and the card treats it as the model's.
    await saveReading(savedAt(1_000));
    const older = await storedReadingById('reading-1000');
    expect(older?.outcome.metrics.rhythm?.scorer).toBeUndefined();
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

describe('pastReadings: what earlier readings give the history rules', () => {
  const day = (createdAt: number) => ({ ms: createdAt, day: `day-${createdAt}` });
  function withMetrics(createdAt: number, quality: 'standard' | 'low', flagged: boolean) {
    const saved = savedAt(createdAt);
    const { metrics } = saved.results;
    const tag = { quality, qualityReasons: quality === 'low' ? (['shortClean'] as const) : [] };
    metrics.rhythm = {
      class: flagged ? 'af' : 'sinus',
      pAF: flagged ? 0.9 : 0.1,
      evidence: 'experimental',
      confidence: 'low',
      flag: flagged ? 'irregular' : null,
      ...tag,
      qualityReasons: [...tag.qualityReasons],
    };
    metrics.rmssd = { ...metrics.rmssd!, ...tag, qualityReasons: [...tag.qualityReasons] };
    // The card holds the mean over readings; the model's own output for this reading is in the models JSON.
    metrics.diabetes = {
      probability: 0.5,
      readingsUsed: 2,
      evidence: 'experimental',
      confidence: 'moderate',
      flag: null,
      ...tag,
      qualityReasons: [...tag.qualityReasons],
    };
    return {
      ...saved,
      context: { ...CONTEXT, recordedAt: day(createdAt) },
      models: { rhythm: null, diabetes: { probability: 0.7, tauDm: 0.5 } },
    };
  }

  it('lists each reading newest first with its rhythm flag, RMSSD, and its own diabetes probability', async () => {
    await saveReading(withMetrics(1000, 'standard', false));
    await saveReading(withMetrics(2000, 'standard', true));
    expect(await pastReadings()).toEqual([
      {
        atMs: 2000,
        rhythmPositive: true,
        rmssdMs: 48,
        diabetes: { day: 'day-2000', probability: 0.7, confidence: 'moderate' },
      },
      {
        atMs: 1000,
        rhythmPositive: false,
        rmssdMs: 48,
        diabetes: { day: 'day-1000', probability: 0.7, confidence: 'moderate' },
      },
    ]);
  });

  it('counts a lower-quality irregular flag but keeps lower-quality values out of bands and the mean', async () => {
    await saveReading(withMetrics(1000, 'low', true));
    expect(await pastReadings()).toEqual([
      { atMs: 1000, rhythmPositive: true, rmssdMs: null, diabetes: null },
    ]);
  });

  it('reads a reading saved before quality existed as standard, and one with no day as no diabetes reading', async () => {
    await saveReading({
      ...savedAt(1000),
      models: { rhythm: null, diabetes: { probability: 0.7, tauDm: 0.5 } },
    });
    const [past] = await pastReadings();
    expect(past).toMatchObject({ atMs: 1000, rhythmPositive: false, rmssdMs: 48, diabetes: null });
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
