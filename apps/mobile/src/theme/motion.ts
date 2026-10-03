import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// Motion values shared by every animated component. Short and settled: nothing here should call attention
// to itself.
export const motion = {
  pressScale: 0.97,
  pressSpring: { damping: 22, stiffness: 420, mass: 0.6 },
  fadeMs: 160,
  sheetMs: 260,
  progressMs: 400,
} as const;

// The OS "Reduce Motion" setting, read through React Native so tests drive it the same way the phone does.
// Components that move check it and switch to no movement or a plain fade.
let reduceMotionOn = false;
let watching = false;
const listeners = new Set<() => void>();

function setReduceMotion(next: boolean) {
  if (next === reduceMotionOn) return;
  reduceMotionOn = next;
  listeners.forEach((listener) => listener());
}

function watchReduceMotion() {
  if (watching) return;
  watching = true;
  // If the platform cannot answer, motion stays on, which is the default for a phone with no setting.
  Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(setReduceMotion, () => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
}

function subscribe(listener: () => void) {
  watchReduceMotion();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduceMotionOn);
}
