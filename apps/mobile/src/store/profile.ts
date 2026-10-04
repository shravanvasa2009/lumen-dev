import type { Profile } from '@lumen/core';

import { isDemoActive } from '@/demo/demoSession';

import type { RiskDraft, Sex } from '@/profile/diabetesRisk';

import { lumenDatabase } from './database';

export async function profileValue(key: string): Promise<string | null> {
  const database = await lumenDatabase();
  const row = await database.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM profile WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

const UPSERT =
  'INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

// §8.5: Demo mode writes nothing, so every profile write is skipped while a demo session is on.
export async function setProfileValue(key: string, value: string): Promise<void> {
  if (isDemoActive()) return;
  const database = await lumenDatabase();
  await database.runAsync(UPSERT, [key, value]);
}

// All or none: a failure part-way leaves the earlier values as they were.
export async function setProfileValues(entries: Record<string, string>): Promise<void> {
  if (isDemoActive()) return;
  const database = await lumenDatabase();
  await database.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(entries)) await database.runAsync(UPSERT, [key, value]);
  });
}

const HEALTH_NOTES = [
  'athlete',
  'betaBlocker',
  'pacemaker',
  'knownAf',
] as const satisfies readonly (keyof Profile)[];
export type HealthNote = (typeof HEALTH_NOTES)[number];

// A note never answered counts as not set: no condition is assumed.
export async function loadProfile(): Promise<Profile> {
  const answers = await Promise.all(HEALTH_NOTES.map(async (note) => (await profileValue(note)) === 'true'));
  const [athlete, betaBlocker, pacemaker, knownAf] = answers as [boolean, boolean, boolean, boolean];
  return { athlete, betaBlocker, pacemaker, knownAf };
}

export function saveHealthNote(note: HealthNote, value: boolean): Promise<void> {
  return setProfileValue(note, String(value));
}

const SEXES: readonly Sex[] = ['female', 'male', 'preferNot'];

// The profile table key for each draft field. Age keeps the name the first profile screen used.
const NUMBER_KEYS = { ageYears: 'age', heightCm: 'heightCm', weightKg: 'weightKg' } as const;
const FLAG_KEYS = {
  familyHistory: 'familyHistory',
  hypertension: 'hypertension',
  physicallyActive: 'physicallyActive',
  gestationalDiabetes: 'gestationalDiabetes',
} as const;
const SEX_KEY = 'sex';

// The table holds strings, and Number() would read '' as 0 and ' 5' or '1e2' as numbers. Only plain
// non-negative decimals count; anything else is treated as never answered.
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

async function storedNumber(key: string): Promise<number | null> {
  const text = await profileValue(key);
  if (text === null || !PLAIN_NUMBER.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

async function storedFlag(key: string): Promise<boolean | null> {
  const text = await profileValue(key);
  return text === 'true' ? true : text === 'false' ? false : null;
}

// An unanswered question is absent from the table and loads as null: it is never read as "No".
export async function loadRiskDraft(): Promise<RiskDraft> {
  const [sexText, ageYears, heightCm, weightKg, familyHistory, hypertension, physicallyActive, gestational] =
    await Promise.all([
      profileValue(SEX_KEY),
      storedNumber(NUMBER_KEYS.ageYears),
      storedNumber(NUMBER_KEYS.heightCm),
      storedNumber(NUMBER_KEYS.weightKg),
      storedFlag(FLAG_KEYS.familyHistory),
      storedFlag(FLAG_KEYS.hypertension),
      storedFlag(FLAG_KEYS.physicallyActive),
      storedFlag(FLAG_KEYS.gestationalDiabetes),
    ]);
  return {
    ageYears,
    sex: SEXES.find((sex) => sex === sexText) ?? null,
    heightCm,
    weightKg,
    familyHistory,
    hypertension,
    physicallyActive,
    gestationalDiabetes: gestational,
  };
}

export type RiskScope = 'basics' | 'questions' | 'all';

// One screen must not overwrite what the other saved from an older copy, so each saves only its own
// scope. All of it goes in one transaction; a null answer is deleted, so what is stored is what the
// screen shows. Demo mode writes nothing (§8.5).
export async function saveRiskDraft(draft: RiskDraft, scope: RiskScope = 'all'): Promise<void> {
  if (isDemoActive()) return;
  const basics: (readonly [string, string | null])[] = [
    [SEX_KEY, draft.sex],
    ...(Object.keys(NUMBER_KEYS) as (keyof typeof NUMBER_KEYS)[]).map(
      (field) => [NUMBER_KEYS[field], draft[field] === null ? null : String(draft[field])] as const,
    ),
  ];
  // Changing sex away from Female on the basics screen must also remove a pregnancy answer given earlier.
  if (draft.sex !== 'female' && scope === 'basics') basics.push([FLAG_KEYS.gestationalDiabetes, null]);
  const questions = (Object.keys(FLAG_KEYS) as (keyof typeof FLAG_KEYS)[]).map(
    (field) => [FLAG_KEYS[field], draft[field] === null ? null : String(draft[field])] as const,
  );
  const entries = scope === 'basics' ? basics : scope === 'questions' ? questions : [...basics, ...questions];
  const database = await lumenDatabase();
  await database.withTransactionAsync(async () => {
    for (const [key, value] of entries) {
      if (value === null) await database.runAsync('DELETE FROM profile WHERE key = ?', [key]);
      else await database.runAsync(UPSERT, [key, value]);
    }
  });
}
