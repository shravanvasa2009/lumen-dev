import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import type { Coordinates } from './clinics';

// asking: the system prompt or the fix is pending; denied: no permission; failed: permission but no fix.
export type CareLocation =
  | { status: 'asking' }
  | { status: 'ready'; origin: Coordinates }
  | { status: 'denied' }
  | { status: 'failed' };

// Foreground permission only, asked when the Care map opens (ADR 0054 §5); Low accuracy is enough to find a
// clinic within a few miles, and nothing is stored.
// https://docs.expo.dev/versions/v57.0.0/sdk/location/
export function useCareLocation(): CareLocation {
  const [location, setLocation] = useState<CareLocation>({ status: 'asking' });
  useEffect(() => {
    let cancelled = false;
    async function locate(): Promise<CareLocation> {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) return { status: 'denied' };
      try {
        const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        return { status: 'ready', origin: { lat: coords.latitude, lon: coords.longitude } };
      } catch {
        return { status: 'failed' };
      }
    }
    locate()
      .catch((): CareLocation => ({ status: 'failed' }))
      .then((next) => {
        if (!cancelled) setLocation(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return location;
}
