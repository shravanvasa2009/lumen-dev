import { Linking } from 'react-native';

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
