import type { StoredReading } from '@/home/readings';
import { useStoredReading } from '@/store/useStoredReadings';

import { type FixtureReading, readingById } from './fixtures';

// The beat intervals, the repeat counter and the diabetes days are not in the readings row, so a stored
// reading shows none of them instead of invented ones.
function fromStored(stored: StoredReading): FixtureReading {
  return {
    id: stored.id,
    mode: stored.mode ?? 'quick',
    createdAt: new Date(stored.takenAt),
    sample: false,
    synthetic: false,
    scan: stored.outcome,
    intervalsMs: [],
    repeat: null,
    diabetesDays: [],
  };
}

// The sample readings (Demo and Replay) by their fixed ids, otherwise the reading saved on this phone.
// undefined while a saved reading loads, null when there is none with that id.
export function useResultsReading(id: string | undefined): FixtureReading | null | undefined {
  const sample = readingById(id);
  const stored = useStoredReading(sample ? undefined : id);
  if (sample) return sample;
  return stored ? fromStored(stored) : stored;
}
