import { DSP_CONFIG } from './config';
import { butterLowpass, filterZeroPhase } from './filters';
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

/** DSP-3: DC level (zero-phase Butterworth low-pass below 0.3 Hz) of a uniformly sampled channel. */
export function dcLevel(channel: ArrayLike<number>, rateHz: number): Float64Array {
  const { dcOrder, dcCutoffHz } = DSP_CONFIG.dsp3;
  return filterZeroPhase(butterLowpass(dcOrder, dcCutoffHz, rateHz), channel);
}
