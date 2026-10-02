import { useSyncExternalStore } from 'react';

type Appearance = 'system' | 'light' | 'dark';

type Preferences = {
  appearance: Appearance;
  hideWidgetValues: boolean;
};

// Held in memory only: storage and scheduling arrive with the notification and storage tracks.
let current: Preferences = {
  appearance: 'system',
  hideWidgetValues: false,
};
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences() {
  return useSyncExternalStore(subscribe, () => current);
}

export function setPreference<Key extends keyof Preferences>(key: Key, value: Preferences[Key]) {
  current = { ...current, [key]: value };
  listeners.forEach((listener) => listener());
}
