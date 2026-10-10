import type { ModelOutputs, PastReading, ReadingContext, ReadingResult } from '@lumen/core';

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
  intervalsMs: readonly number[];
};

type ReadingRow = {
  id: string;
  created_at: number;
  mode: string;
  results_json: string;
  intervals_json: string | null;
};

const READING_COLUMNS = 'id, created_at, mode, results_json, intervals_json';

function toStoredReading(row: ReadingRow): StoredReading {
  return {
    id: row.id,
    takenAt: row.created_at,
    mode: parseMode(row.mode),
    outcome: JSON.parse(row.results_json) as ReadingResult,
    intervalsMs: row.intervals_json === null ? [] : (JSON.parse(row.intervals_json) as number[]),
  };
}

// demo is 0: Demo and Replay readings are never written to the readings table.
export async function saveReading(reading: SavedReading): Promise<void> {
  const database = await lumenDatabase();
  await database.runAsync(
    'INSERT INTO readings (id, created_at, mode, context_json, results_json, models_json, intervals_json, demo) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    [
      reading.id,
      reading.createdAt,
      reading.mode,
      JSON.stringify(reading.context),
      JSON.stringify(reading.results),
      JSON.stringify(reading.models),
      JSON.stringify(reading.intervalsMs),
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

type HistoryRow = { created_at: number; context_json: string; results_json: string; models_json: string };

/** Earlier readings as buildReadingResult's history rules read them, newest first. */
export async function pastReadings(): Promise<PastReading[]> {
  const database = await lumenDatabase();
  const rows = await database.getAllAsync<HistoryRow>(
    'SELECT created_at, context_json, results_json, models_json FROM readings ORDER BY created_at DESC',
  );
  return rows.map((row) => {
    const context = JSON.parse(row.context_json) as ReadingContext;
    const { metrics } = JSON.parse(row.results_json) as ReadingResult;
    const models = JSON.parse(row.models_json) as ModelOutputs;
    // ADR 0104: a lower-quality irregular flag still counts toward 2 of 3, but lower-quality values stay out of
    // the personal band and the diabetes mean. A reading saved before the quality fields existed was standard.
    const standard = (metric: { quality?: string } | null) => metric !== null && metric.quality !== 'low';
    const day = context.recordedAt?.day;
    return {
      atMs: row.created_at,
      rhythmPositive: metrics.rhythm?.flag != null,
      rmssdMs: standard(metrics.rmssd) ? metrics.rmssd!.value : null,
      // The card shows the mean over readings; the history needs this reading's own model output.
      diabetes:
        standard(metrics.diabetes) && models.diabetes && day
          ? { day, probability: models.diabetes.probability, confidence: metrics.diabetes!.confidence }
          : null,
    };
  });
}

export async function storedReadingById(id: string): Promise<StoredReading | null> {
  const database = await lumenDatabase();
  const row = await database.getFirstAsync<ReadingRow>(
    `SELECT ${READING_COLUMNS} FROM readings WHERE id = ?`,
    [id],
  );
  return row === null ? null : toStoredReading(row);
}
