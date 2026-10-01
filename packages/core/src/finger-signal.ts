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

// Population SD (divide by n), sums in index order, so ml/lumen_dsp/signals.py gives the same doubles.
/** DSP-3: z-score of one model-input window; null when the window is flat (SD 0), as nothing can be scored. */
export function zScoreWindow(window: ArrayLike<number>): Float64Array | null {
  const values = Array.from(window);
  if (values.every((value) => value === values[0])) return null;
  let total = 0;
  for (const value of values) total += value;
  const mean = total / values.length;
  let squares = 0;
  for (const value of values) squares += (value - mean) ** 2;
  const sd = Math.sqrt(squares / values.length);
  return Float64Array.from(values, (value) => (value - mean) / sd);
}

/** DSP-3: SQI-Net v1 input (ADR 0023), 256 float32: the 4 s primary (−R) window, z-scored; null if flat. */
export function sqiModelInput(primary: ArrayLike<number>): Float32Array | null {
  const samples = DSP_CONFIG.dsp3.modelWindowS * DSP_CONFIG.dsp2.modelRateHz;
  if (primary.length !== samples)
    throw new RangeError(`SQI windows need ${samples} samples, got ${primary.length}`);
  const scored = zScoreWindow(primary);
  return scored && Float32Array.from(scored);
}

/** DSP-3: DC level (zero-phase Butterworth low-pass below 0.3 Hz) of a uniformly sampled channel. */
export function dcLevel(channel: ArrayLike<number>, rateHz: number): Float64Array {
  const { dcOrder, dcCutoffHz } = DSP_CONFIG.dsp3;
  return filterZeroPhase(butterLowpass(dcOrder, dcCutoffHz, rateHz), channel);
}
