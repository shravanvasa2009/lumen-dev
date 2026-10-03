import type { Profile } from '@lumen/core';

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

export async function setProfileValue(key: string, value: string): Promise<void> {
  const database = await lumenDatabase();
  await database.runAsync(UPSERT, [key, value]);
}

// All or none: a failure part-way leaves the earlier values as they were.
export async function setProfileValues(entries: Record<string, string>): Promise<void> {
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
