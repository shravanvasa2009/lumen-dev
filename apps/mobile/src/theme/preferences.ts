import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { isRecord } from '@/evidence';
import { publishWidgets } from '@/widgets/publish';

export type Appearance = 'system' | 'light' | 'dark';

type Preferences = {
  appearance: Appearance;
  hideWidgetValues: boolean;
};

const defaults: Preferences = { appearance: 'system', hideWidgetValues: false };

const PREFS_FILE = 'preferences.json';
const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

const prefsFile = () => new File(Paths.document, PREFS_FILE);

// Saved, so "Hide values on widgets" still holds after a restart: the next publish (after a reading) would
// otherwise send the heart rate the user asked to hide. Each field falls back to its default on its own.
function loadPreferences(): Preferences {
  const file = prefsFile();
  if (!file.exists) return defaults;
  try {
    const stored: unknown = JSON.parse(file.textSync());
    if (!isRecord(stored)) return defaults;
    return {
      appearance: APPEARANCES.find((value) => value === stored.appearance) ?? defaults.appearance,
      hideWidgetValues:
        typeof stored.hideWidgetValues === 'boolean' ? stored.hideWidgetValues : defaults.hideWidgetValues,
    };
  } catch (error) {
    // A damaged file must not stop the app opening; defaults apply and the next change replaces it.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Preferences could not be read, using defaults: ${reason}`);
    return defaults;
  }
}

let current: Preferences = loadPreferences();
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
  try {
    const file = prefsFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(current));
  } catch (error) {
    // The choice still applies for this session; a toggle handler must not crash the app over a full disk.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Preferences could not be saved: ${reason}`);
  }
  // The widget snapshot carries both (Appendix B). A failed publish is reported, since release builds drop
  // unhandled rejections; the widget keeps its previous snapshot.
  publishWidgets(current).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Widget update failed: ${reason}`);
  });
}

export function resetPreferences() {
  current = defaults;
  listeners.forEach((listener) => listener());
  const file = prefsFile();
  if (file.exists) file.delete();
}
