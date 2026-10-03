import { Platform } from 'react-native';

import type { Coordinates } from './clinics';

// Android: https://developer.android.com/guide/components/intents-common#Maps
// iOS: https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html
export function doctorSearchUrl(near: Coordinates): string {
  const query = encodeURIComponent('doctor');
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${query}&ll=${near.lat},${near.lon}`
    : `geo:${near.lat},${near.lon}?q=${query}`;
}

export function directionsUrl(destination: Coordinates, label: string): string {
  const name = encodeURIComponent(label);
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?daddr=${destination.lat},${destination.lon}&q=${name}`
    : `geo:0,0?q=${destination.lat},${destination.lon}(${name})`;
}
