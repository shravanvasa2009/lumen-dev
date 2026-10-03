import { useSyncExternalStore } from 'react';

import { publishWidgets } from '@/widgets/publish';

export type Appearance = 'system' | 'light' | 'dark';

type Preferences = {
  appearance: Appearance;
  hideWidgetValues: boolean;
};

// Held in memory only: storage and scheduling arrive with the notification and storage tracks.
const defaults: Preferences = { appearance: 'system', hideWidgetValues: false };

let current: Preferences = defaults;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences() {
  return useSyncExternalStore(subscribe, () => current);
}

// For code outside React, such as the widget publish after a saved reading.
export function currentPreferences(): Preferences {
  return current;
}

export function setPreference<Key extends keyof Preferences>(key: Key, value: Preferences[Key]) {
  current = { ...current, [key]: value };
  listeners.forEach((listener) => listener());
  // The widget snapshot carries both (Appendix B). A failed publish is reported, since release builds drop
  // unhandled rejections; the widget keeps its previous snapshot.
  if (key === 'hideWidgetValues' || key === 'appearance') {
    publishWidgets(current).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Widget update failed: ${reason}`);
    });
  }
}

export function resetPreferences() {
  current = defaults;
  listeners.forEach((listener) => listener());
}
