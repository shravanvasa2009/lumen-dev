import type { FixtureReading } from '@/results/fixtures';

// In memory only, like the kept capture: the SQLite readings store is a later task, and until then this is
// where the Results screen can look a finished reading up by the id Processing handed it.
const finished = new Map<string, FixtureReading>();

export function saveFinishedReading(reading: FixtureReading): void {
  finished.set(reading.id, reading);
}

export function finishedReading(readingId: string | undefined): FixtureReading | undefined {
  return readingId === undefined ? undefined : finished.get(readingId);
}
