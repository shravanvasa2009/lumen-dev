import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { Coordinates } from './clinics';

export type NearbyDoctor = Coordinates & { name: string; phone?: string; address: string };

// Track B's Swift function (ADR 0054 §4, order A.B_TASK-care-search-swift). Until it ships the module has no
// such member and iOS uses the same "Search doctors in Maps" button as Android.
type CareSearchModule = {
  searchNearbyCare?: (lat: number, lon: number, radiusM: number, query: string) => Promise<NearbyDoctor[]>;
};

// Error code Track B's function must reject with when Apple's MKLocalSearch is rate-limited
// (MKError.loadingThrottled), so the screen can say "try again shortly".
export const SEARCH_THROTTLED_CODE = 'ERR_CARE_SEARCH_THROTTLED';
const SEARCH_RADIUS_METERS = 8000;

function careModule(): CareSearchModule | null {
  return Platform.OS === 'ios' ? requireOptionalNativeModule<CareSearchModule>('LumenCapture') : null;
}

export const canSearchNearbyDoctors = () => typeof careModule()?.searchNearbyCare === 'function';

export async function searchNearbyDoctors(near: Coordinates): Promise<NearbyDoctor[]> {
  const native = careModule();
  if (!native?.searchNearbyCare) throw new Error('searchNearbyCare is not in this build');
  return native.searchNearbyCare(near.lat, near.lon, SEARCH_RADIUS_METERS, 'doctor');
}
