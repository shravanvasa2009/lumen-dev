import type { ReadingResult } from '@lumen/core';

// In memory only, like the kept capture: the SQLite readings store is a later task, and until then this is
// where the Results screen can look a finished reading up by the id Processing handed it.
const finished = new Map<string, ReadingResult>();

export function saveFinishedReading(readingId: string, reading: ReadingResult): void {
  finished.set(readingId, reading);
}

export function finishedReading(readingId: string): ReadingResult | undefined {
  return finished.get(readingId);
}
