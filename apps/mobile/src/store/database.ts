import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

const DATABASE_NAME = 'lumen.db';

// Bump when a table changes, and add the step that gets a version-N database to N+1 to `migrate`.
const SCHEMA_VERSION = 1;

// Appendix B, "SQLite tables (on the phone)".
const SCHEMA_V1 = `
CREATE TABLE readings (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, mode TEXT NOT NULL,
  app_version TEXT, device_model TEXT, rating_score INTEGER, rating_tier TEXT, lens_id TEXT,
  context_json TEXT, results_json TEXT NOT NULL, quality_json TEXT, models_json TEXT,
  capture_path TEXT, demo INTEGER DEFAULT 0);
CREATE TABLE profile (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE baselines (metric TEXT, computed_at INTEGER, median REAL, iqr REAL, n INTEGER,
  PRIMARY KEY (metric, computed_at));
CREATE TABLE device_rating (id INTEGER PRIMARY KEY, tested_at INTEGER, os_version TEXT,
  app_version TEXT, score INTEGER, tier TEXT, components_json TEXT, lens_id TEXT);
`;

async function migrate(database: SQLiteDatabase): Promise<void> {
  const found = (await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version;
  if (found === undefined) throw new Error('SQLite did not report a schema version');
  // A newer build wrote this file; opening it with older table definitions could lose its data.
  if (found > SCHEMA_VERSION)
    throw new Error(`the stored data is schema version ${found}, newer than this app's ${SCHEMA_VERSION}`);
  if (found < 1)
    await database.withTransactionAsync(async () => {
      await database.execAsync(SCHEMA_V1);
      await database.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
}

async function openAndMigrate(): Promise<SQLiteDatabase> {
  const database = await openDatabaseAsync(DATABASE_NAME);
  await migrate(database);
  return database;
}

let opened: Promise<SQLiteDatabase> | null = null;

// One connection for the whole app. A failed open is forgotten so the next call tries again.
export function lumenDatabase(): Promise<SQLiteDatabase> {
  opened ??= openAndMigrate().catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}
