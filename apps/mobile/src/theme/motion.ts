import { createContext, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { Easing, FadeIn, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';

// Motion tokens, spec section 12.1 and ADR 0075: every timed animation is 200 ms ease-out. The one addition is
// the short press spring outside the capture screen, where nothing moves except the waveform and the ring.
export const motion = {
  durationMs: 200,
  // A readout that updates about once a second (the signal marker, a progress ring) glides to each new value; 200 ms
  // would read as a jump followed by a wait.
  glideMs: 600,
  // Sections that appear together on one screen start this far apart, up to staggerMax of them, so the last one
  // is not still arriving a second later.
  staggerMs: 40,
  staggerMax: 6,
  // How far a changed readout rises as it settles, in dp, and how dim it starts.
  settleRiseDp: 6,
  settleFromOpacity: 0.5,
  pressScale: 0.97,
  pressSpring: { damping: 22, stiffness: 420, mass: 0.6 },
} as const;

export const easeOut = Easing.out(Easing.cubic);

// Timing options for withTiming. Reduce Motion is the live setting, so toggling it changes the next animation.
export function timingConfig(reduceMotion: boolean) {
  return { duration: motion.durationMs, easing: easeOut, reduceMotion: reduceMotionMode(reduceMotion) };
}

export function glideConfig(reduceMotion: boolean) {
  return { duration: motion.glideMs, easing: easeOut, reduceMotion: reduceMotionMode(reduceMotion) };
}

// Layout animations for content that appears, goes, or is pushed aside. They run on the UI thread.
export function enterTransition(reduceMotion: boolean, index = 0) {
  return FadeIn.duration(motion.durationMs)
    .easing(easeOut)
    .delay(Math.min(index, motion.staggerMax) * motion.staggerMs)
    .reduceMotion(reduceMotionMode(reduceMotion));
}

export function exitTransition(reduceMotion: boolean) {
  return FadeOut.duration(motion.durationMs).easing(easeOut).reduceMotion(reduceMotionMode(reduceMotion));
}

export function settleTransition(reduceMotion: boolean) {
  return LinearTransition.duration(motion.durationMs)
    .easing(easeOut)
    .reduceMotion(reduceMotionMode(reduceMotion));
}

// Screen-to-screen animation for a native stack. iOS keeps the system push, which follows the swipe-back gesture.
// Android's own default varies by OS version (and is a fade on some), so every Android phone gets the same
// iOS-style slide, which reads as moving deeper into the app.
// https://reactnavigation.org/docs/native-stack-navigator/#animation
export function stackAnimation(reduceMotion: boolean) {
  if (reduceMotion) return 'none';
  return Platform.OS === 'android' ? 'ios_from_right' : 'default';
}

// Always makes Reanimated finish the animation at once; Never plays it. (System would read the setting a
// second time, separately from useReduceMotion.)
export function reduceMotionMode(reduceMotion: boolean) {
  return reduceMotion ? ReduceMotion.Always : ReduceMotion.Never;
}

// The capture screen sets this so nothing under it moves except the waveform and the ring.
export const StillMotion = createContext(false);

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
  Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(setReduceMotion, (error: unknown) => {
    console.warn('Could not read the Reduce Motion setting; motion stays on.', error);
  });
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
