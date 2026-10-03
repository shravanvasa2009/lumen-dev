import { useSyncExternalStore } from 'react';

// §8.5: Demo mode lives in memory only. Entering it never records that onboarding is done, so the next
// launch still starts at Welcome, and nothing a demo produces is written to the readings table.
let active = false;
const listeners = new Set<() => void>();

function setDemo(next: boolean): void {
  if (active === next) return;
  active = next;
  listeners.forEach((listener) => listener());
}

export const enterDemo = (): void => setDemo(true);
export const exitDemo = (): void => setDemo(false);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDemoActive(): boolean {
  return useSyncExternalStore(subscribe, () => active);
}
