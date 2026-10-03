/// <reference types="node" />
// Jest has no native SQLite, so this runs the same SQL on Node's built-in engine (node:sqlite, Node 22.18+,
// the version package.json requires). The subset covers what src/store uses.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

type BindParams = SQLInputValue[];

// expo-sqlite takes bind values as one array or as separate arguments.
const bindValues = (params: unknown[]): BindParams =>
  (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as BindParams;

class MockDatabase {
  constructor(private readonly engine: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.engine.exec(source);
  }

  async runAsync(source: string, ...params: unknown[]) {
    const { changes, lastInsertRowid } = this.engine.prepare(source).run(...bindValues(params));
    return { changes: Number(changes), lastInsertRowId: Number(lastInsertRowid) };
  }

  async getFirstAsync<Row>(source: string, ...params: unknown[]): Promise<Row | null> {
    return (this.engine.prepare(source).get(...bindValues(params)) as Row | undefined) ?? null;
  }

  async getAllAsync<Row>(source: string, ...params: unknown[]): Promise<Row[]> {
    return this.engine.prepare(source).all(...bindValues(params)) as Row[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.engine.exec('BEGIN');
    try {
      await task();
    } catch (error) {
      this.engine.exec('ROLLBACK');
      throw error;
    }
    this.engine.exec('COMMIT');
  }

  emptyEveryTable(): void {
    const tables = this.engine
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) this.engine.exec(`DELETE FROM "${name}"`);
  }
}

const openDatabases = new Map<string, MockDatabase>();

export async function openDatabaseAsync(name: string): Promise<MockDatabase> {
  let database = openDatabases.get(name);
  if (database === undefined) {
    database = new MockDatabase(new DatabaseSync(':memory:'));
    openDatabases.set(name, database);
  }
  return database;
}

// For tests: keeps the schema and the open connection, drops the rows, so each test starts with no readings.
export function emptyMockDatabases(): void {
  for (const database of openDatabases.values()) database.emptyEveryTable();
}
