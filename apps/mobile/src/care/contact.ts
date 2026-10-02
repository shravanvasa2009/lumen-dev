import { Linking, Platform } from 'react-native';

import type { Coordinates } from './clinics';

// Keeps digits and a leading plus so "(713) 555-0100" dials; the visible text keeps its formatting.
function dialableNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export async function opensOk(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export function callNumber(phone: string): Promise<boolean> {
  return opensOk(`tel:${dialableNumber(phone)}`);
}

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
