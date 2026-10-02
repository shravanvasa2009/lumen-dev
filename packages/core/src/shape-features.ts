import { DSP_CONFIG } from './config';
import { systolicPeakIndex, type PulseShape } from './pulse-shape';

// diabetes-net's 12 shape features (§11.4, ML-6), mirrored by ml/lumen_dsp/shape_features.py. The DSP-14
// window is exactly one period: sample k sits at onset + (k / 256 − lead fraction) × period, so the onset
// is at 25.6 and the lead-in (samples 0–25) is the end of the previous period. Times are fractions of the
// period, so they do not depend on fps or heart rate. Amplitudes are measured on the smoothed beat above
// the onset level, relative to the systolic peak, so min–max normalization does not affect them.
// Undefined features are null; core never imputes (the model applies its training median).

// Linear interpolation crossing of `level` between samples k and k + 1.
const crossing = (smoothed: Float64Array, k: number, level: number) =>
  k + (level - smoothed[k]!) / (smoothed[k + 1]! - smoothed[k]!);

// Width of the systolic peak where the beat crosses `level`: the last rise through it before the peak to
// the first fall through it after the peak, within the window.
function peakWidth(smoothed: Float64Array, peak: number, level: number): number | null {
  let rise: number | null = null;
  for (let k = peak - 1; k >= 0 && rise === null; k--)
    if (smoothed[k]! < level && smoothed[k + 1]! >= level) rise = crossing(smoothed, k, level);
  let fall: number | null = null;
  for (let k = peak; k + 1 < smoothed.length && fall === null; k++)
    if (smoothed[k]! >= level && smoothed[k + 1]! < level) fall = crossing(smoothed, k, level);
  return rise === null || fall === null ? null : (fall - rise) / smoothed.length;
}

// Diastolic area over systolic area, by the trapezoid rule on heights above the onset level (0 at the
// onset itself). Systolic: onset → notch. Diastolic: notch → window end, then on through the lead-in back
// to the onset, since the lead-in is the end of the same cardiac cycle in phase.
function areaRatio(height: (k: number) => number, onset: number, notch: number, samples: number) {
  const first = Math.floor(onset);
  let systolic = (height(first + 1) / 2) * (first + 1 - onset);
  for (let k = first + 1; k < notch; k++) systolic += (height(k) + height(k + 1)) / 2;
  let diastolic = 0;
  for (let k = notch; k < samples - 1; k++) diastolic += (height(k) + height(k + 1)) / 2;
  diastolic += (height(samples - 1) + height(0)) / 2;
  for (let k = 0; k < first; k++) diastolic += (height(k) + height(k + 1)) / 2;
  diastolic += (height(first) / 2) * (onset - first);
  return systolic > 0 ? diastolic / systolic : null;
}

// The highest local maximum after the notch, relative to the peak height; 0 when the beat only decays.
function diastolicPeak(height: (k: number) => number, notch: number, samples: number, peakHeight: number) {
  let highest = 0;
  for (let k = notch + 1; k < samples - 1; k++)
    if (height(k - 1) < height(k) && height(k) >= height(k + 1)) highest = Math.max(highest, height(k));
  return highest / peakHeight;
}

/** ML-6: diabetes-net's 12 shape features from a DSP-14 pulse shape, null where undefined. */
export function shapeFeatures(shape: PulseShape): (number | null)[] {
  const { smoothed, secondDerivative, waves } = shape;
  const samples = smoothed.length;
  const onset = DSP_CONFIG.dsp14.leadFraction * samples;
  const first = Math.floor(onset);
  const onsetLevel = smoothed[first]! + (smoothed[first + 1]! - smoothed[first]!) * (onset - first);
  const height = (k: number) => smoothed[k]! - onsetLevel;
  const peak = systolicPeakIndex(smoothed);
  const peakHeight = height(peak);
  // A flat beat, or one whose highest systolic sample is not after the onset, has no systolic peak.
  const hasPeak = peakHeight > 0 && peak > onset;
  // The notch is the e-wave; one before the systolic peak cannot be the dicrotic notch.
  const notch = hasPeak && waves.e !== null && waves.e > peak ? waves.e : null;

  const [upperLevel, lowerLevel] = DSP_CONFIG.diabetesFeatures.widthLevels;
  const width = (fraction: number) =>
    hasPeak ? peakWidth(smoothed, peak, onsetLevel + fraction * peakHeight) : null;

  const a = waves.a === null ? 0 : secondDerivative[waves.a]!;
  // Ratios to the a-wave mean nothing unless it is a positive maximum.
  const ratio = (wave: number | null) => (a > 0 && wave !== null ? secondDerivative[wave]! / a : null);
  const [b, c, d, e] = [ratio(waves.b), ratio(waves.c), ratio(waves.d), ratio(waves.e)];

  return [
    hasPeak ? (peak - onset) / samples : null,
    width(upperLevel!),
    width(lowerLevel!),
    notch === null ? null : (notch - onset) / samples,
    notch === null ? null : height(notch) / peakHeight,
    notch === null ? null : diastolicPeak(height, notch, samples, peakHeight),
    b,
    c,
    d,
    e,
    b === null || c === null || d === null || e === null ? null : b - c - d - e,
    notch === null ? null : areaRatio(height, onset, notch, samples),
  ];
}
