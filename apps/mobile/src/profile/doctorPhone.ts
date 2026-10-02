import { useSyncExternalStore } from 'react';

// Digits, spaces and + - ( ) only, with at least one digit so "()" cannot be saved as a number.
const PHONE_PATTERN = /^[0-9 +\-()]+$/;

export function isValidPhone(text: string): boolean {
  return PHONE_PATTERN.test(text) && /\d/.test(text);
}

// Held in memory only, like the preferences: the profile has no persistent store yet.
let current: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setPhone(phone: string | null) {
  current = phone;
  listeners.forEach((listener) => listener());
}

export function useDoctorPhone(): { phone: string | null; setPhone(phone: string | null): void } {
  const phone = useSyncExternalStore(subscribe, () => current);
  return { phone, setPhone };
}
