import { Platform } from 'react-native';

import { lumenDatabase } from '@/store/database';
import { listReadings, saveReading, type SavedReading } from '@/store/readings';

import nitin from './seed/nitin.json';
import shravan from './seed/shravan.json';

// SHOWCASE ONLY: made-up morning readings for the demo film (owner, 2026-10-17), written by
// tools/showcase/make-seed.mjs from synthetic signals run through @lumen/core and the shipped models.
export type SeedReading = Omit<SavedReading, 'id' | 'createdAt'> & { daysAgo: number; minuteOfDay: number };

// The JSON is the generator's output; seed.test.ts checks its shape and values.
export const seedReadings = (Platform.OS === 'ios' ? nitin : shravan) as unknown as readonly SeedReading[];

function localDay(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Local wall-clock time, so a daylight-saving change in the last 30 days keeps every reading in the morning.
export function seededAt(nowMs: number, daysAgo: number, minuteOfDay: number): number {
  const date = new Date(nowMs);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return date.getTime();
}

/** Fills an empty readings table with this phone's person's seed history; returns how many were saved. */
export async function seedHistory(nowMs: number): Promise<number> {
  if ((await listReadings()).length > 0) return 0;
  const database = await lumenDatabase();
  // One transaction, so a crash part-way leaves the table empty and the next launch seeds it again.
  await database.withTransactionAsync(async () => {
    for (const { daysAgo, minuteOfDay, context, ...reading } of seedReadings) {
      const createdAt = seededAt(nowMs, daysAgo, minuteOfDay);
      await saveReading({
        ...reading,
        id: `reading-${createdAt}`,
        createdAt,
        // The diabetes check counts calendar days from this, so it must be the phone's own date.
        context: { ...context, recordedAt: { ms: createdAt, day: localDay(createdAt) } },
      });
    }
  });
  return seedReadings.length;
}
