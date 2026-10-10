import { demoReadingById } from '@/demo/demoReadings';
import type { StoredReading } from '@/home/readings';
import { useStoredReading } from '@/store/useStoredReadings';

import { type FixtureReading, readingById } from './fixtures';

// The repeat counter and the diabetes days are not in the readings row, so a stored reading shows none of
// them instead of invented ones. A reading saved before its intervals were kept has none, and draws no chart.
export function fromStored(stored: StoredReading): FixtureReading {
  return {
    id: stored.id,
    mode: stored.mode ?? 'quick',
    createdAt: new Date(stored.takenAt),
    sample: false,
    synthetic: false,
    scan: stored.outcome,
    intervalsMs: stored.intervalsMs ?? [],
    repeat: null,
    diabetesDays: [],
  };
}

// The sample readings (Demo and Replay) by their fixed ids, otherwise the reading saved on this phone.
// undefined while a saved reading loads, null when there is none with that id.
export function useResultsReading(id: string | undefined): FixtureReading | null | undefined {
  const sample = readingById(id) ?? demoReadingById(id);
  const stored = useStoredReading(sample ? undefined : id);
  if (sample) return sample;
  return stored ? fromStored(stored) : stored;
}
