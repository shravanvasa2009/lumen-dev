import type { Timebase } from './timebase';

export interface FingerSignals {
  primary: Float64Array; // −R: more blood absorbs more red light, so inverting makes the pulse rise
  secondary: Float64Array; // −G
}

/** DSP-3: the finger PPG signals from per-frame channel means. */
export function fingerSignals(timebase: Timebase): FingerSignals {
  return {
    primary: timebase.r.map((red) => -red),
    secondary: timebase.g.map((green) => -green),
  };
}
