import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { loadDeviceRating, type StoredRating } from './deviceRating';
import { useLoaded } from './useStoredReadings';

// undefined while the first read runs, null when this phone has not been rated. It reads again each time the
// screen comes into focus, because the Settings and Home tabs stay mounted across a re-test.
export function useStoredRating(): StoredRating | null | undefined {
  const [rating, load] = useLoaded<StoredRating | null | undefined>(undefined);
  useFocusEffect(useCallback(() => load(loadDeviceRating), [load]));
  return rating;
}
