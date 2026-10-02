import type { ModelOutputs, ReadingContext, ReadingResult } from '@lumen/core';

import type { StoredReading } from '@/home/readings';
import { parseMode, type MeasureMode } from '@/measure/mode';

import { lumenDatabase } from './database';

export type SavedReading = {
  id: string;
  createdAt: number;
  mode: MeasureMode;
  context: ReadingContext;
  results: ReadingResult;
  models: ModelOutputs;
};

type ReadingRow = { id: string; created_at: number; mode: string; results_json: string };

const READING_COLUMNS = 'id, created_at, mode, results_json';

function toStoredReading(row: ReadingRow): StoredReading {
  return {
    id: row.id,
    takenAt: row.created_at,
    mode: parseMode(row.mode),
    outcome: JSON.parse(row.results_json) as ReadingResult,
  };
}

// demo is 0: Demo and Replay readings are never written to the readings table.
export async function saveReading(reading: SavedReading): Promise<void> {
  const database = await lumenDatabase();
  await database.runAsync(
    'INSERT INTO readings (id, created_at, mode, context_json, results_json, models_json, demo) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [
      reading.id,
      reading.createdAt,
      reading.mode,
      JSON.stringify(reading.context),
      JSON.stringify(reading.results),
      JSON.stringify(reading.models),
    ],
  );
}

export async function listReadings(): Promise<StoredReading[]> {
  const database = await lumenDatabase();
  const rows = await database.getAllAsync<ReadingRow>(
    `SELECT ${READING_COLUMNS} FROM readings ORDER BY created_at DESC`,
  );
  return rows.map(toStoredReading);
}

export async function storedReadingById(id: string): Promise<StoredReading | null> {
  const database = await lumenDatabase();
  const row = await database.getFirstAsync<ReadingRow>(
    `SELECT ${READING_COLUMNS} FROM readings WHERE id = ?`,
    [id],
  );
  return row === null ? null : toStoredReading(row);
}
