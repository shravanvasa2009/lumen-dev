import { DSP_CONFIG } from './config';
import { isLocalMax, isLocalMin, systolicPeakIndex, systolicSpanEnd, type PulseShape } from './pulse-shape';

// diabetes-net's 12 shape features (§11.4, ML-6), mirrored by ml/lumen_dsp/shape_features.py. The DSP-14
// window is exactly one period: sample k sits at onset + (k / 256 − lead fraction) × period, so the onset
// is at 25.6 and the lead-in (samples 0–25) is the end of the previous period. Times are fractions of the
// period, so they do not depend on fps or heart rate. Amplitudes are measured on the smoothed beat above
// its minimum, relative to the systolic peak, so a gain and an offset do not affect them (ADR 0059).
// Undefined features are null; core never imputes (the model applies its training median).

// The order of shapeFeatures' output, which diabetes-net's model card and the app share with
// ml/lumen_dsp/shape_features.py SHAPE_FEATURE_NAMES.
export const SHAPE_FEATURE_NAMES = [
  'riseTime',
  'width50',
  'width25',
  'notchTime',
  'notchHeight',
  'diastolicPeakHeight',
  'bOverA',
  'cOverA',
  'dOverA',
  'eOverA',
  'agingIndex',
  'areaRatio',
] as const;

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

// The dicrotic notch marks aortic valve closure, the end of ejection, so it lies after the systolic peak
// and before the end of the DSP-14 systolic span (onset + 0.7 period; ejection lasts about 35–55% of it).
// A visible notch is the first local minimum there that a local maximum (the diastolic peak) follows in
// the window. Without one (Dawber class 3–4) it is the first upward bend: the first positive local
// maximum of the second derivative in the span. The a–e chain's e-wave is not used: on adult and older
// pulses it falls in the diastolic decay, after the diastolic peak (ADR 0059).
function notchIndex(smoothed: Float64Array, secondDerivative: Float64Array, peak: number): number | null {
  const spanEnd = systolicSpanEnd();
  for (let k = peak + 1; k < spanEnd - 1; k++) {
    if (!isLocalMin(smoothed, k)) continue;
    for (let j = k + 1; j < smoothed.length - 1; j++) if (isLocalMax(smoothed, j)) return k;
    break;
  }
  for (let k = peak + 1; k < spanEnd - 1; k++)
    if (isLocalMax(secondDerivative, k) && secondDerivative[k]! > 0) return k;
  return null;
}

// Diastolic area over systolic area, by the trapezoid rule on heights above the beat minimum. Systolic:
// onset → notch. Diastolic: notch → window end, then on through the lead-in back to the onset, since the
// lead-in is the end of the same cardiac cycle in phase.
function areaRatio(
  height: (k: number) => number,
  onset: number,
  onsetHeight: number,
  notch: number,
  samples: number,
) {
  const first = Math.floor(onset);
  let systolic = ((onsetHeight + height(first + 1)) / 2) * (first + 1 - onset);
  for (let k = first + 1; k < notch; k++) systolic += (height(k) + height(k + 1)) / 2;
  let diastolic = 0;
  for (let k = notch; k < samples - 1; k++) diastolic += (height(k) + height(k + 1)) / 2;
  diastolic += (height(samples - 1) + height(0)) / 2;
  for (let k = 0; k < first; k++) diastolic += (height(k) + height(k + 1)) / 2;
  diastolic += ((height(first) + onsetHeight) / 2) * (onset - first);
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
  // The 0.5 Hz high-pass of the DSP-6 morphology band pulls the diastolic tail, and a deep notch, below
  // the onset level; the beat's minimum is the lowest point of the cycle on any band, so every height
  // above it is ≥ 0.
  let reference = smoothed[0]!;
  for (const value of smoothed) reference = Math.min(reference, value);
  const height = (k: number) => smoothed[k]! - reference;
  const onsetHeight = height(first) + (height(first + 1) - height(first)) * (onset - first);
  const peak = systolicPeakIndex(smoothed);
  const peakHeight = height(peak);
  // A flat beat, or one whose highest systolic sample is not after the onset, has no systolic peak.
  const hasPeak = peakHeight > 0 && peak > onset;
  const notch = hasPeak ? notchIndex(smoothed, secondDerivative, peak) : null;

  const [upperLevel, lowerLevel] = DSP_CONFIG.diabetesFeatures.widthLevels;
  const width = (fraction: number) =>
    hasPeak ? peakWidth(smoothed, peak, reference + fraction * peakHeight) : null;

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
    notch === null ? null : areaRatio(height, onset, onsetHeight, notch, samples),
  ];
}
