import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import type { StoredReading } from '@/home/readings';

import { listReadings, storedReadingById } from './readings';

// A failed read is thrown during render and caught by the ErrorBoundary exported from app/_layout.tsx.
function useLoaded<Loaded>(initial: Loaded): [Loaded, (load: () => Promise<Loaded>) => () => void] {
  const [loaded, setLoaded] = useState(initial);
  const [failure, setFailure] = useState<unknown>(null);
  if (failure !== null) throw failure;
  const start = useCallback((load: () => Promise<Loaded>) => {
    let active = true;
    load().then(
      (value) => {
        if (active) setLoaded(value);
      },
      (error: unknown) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return [loaded, start];
}

// Newest first; empty until the first read finishes. Tabs stay mounted, so it reads again each time the
// screen comes into focus.
export function useStoredReadings(): readonly StoredReading[] {
  const [readings, load] = useLoaded<readonly StoredReading[]>([]);
  useFocusEffect(useCallback(() => load(listReadings), [load]));
  return readings;
}

// undefined while loading, null when no reading has that id.
export function useStoredReading(id: string | undefined): StoredReading | null | undefined {
  const [reading, load] = useLoaded<StoredReading | null | undefined>(undefined);
  useEffect(() => {
    if (id === undefined) return;
    return load(() => storedReadingById(id));
  }, [id, load]);
  return reading;
}
