import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useLoaded } from '@/store/useStoredReadings';

import { loadReadProgress, type ReadProgress } from './readProgress';

const NOTHING_READ: ReadProgress = {};

// Reads again each time the Learn tab comes into focus, so a chapter read a moment ago shows its new share.
export function useReadProgress(): ReadProgress {
  const [progress, load] = useLoaded<ReadProgress>(NOTHING_READ);
  useFocusEffect(useCallback(() => load(loadReadProgress), [load]));
  return progress;
}
