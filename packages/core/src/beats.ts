import { DSP_CONFIG } from './config';
import type { ResampledSegment } from './resample';

// Times are seconds from capture start (DSP-1); amplitudes are in morphology-band signal units.
export interface DetectedBeat {
  peakS: number;
  // null when nothing rises between the preceding minimum and the peak, or when the foot was not observed
  // (the upstroke began before the segment); DSP-9 then keeps the beat out of its amplitude and template
  // references.
  onsetS: number | null;
  maxUpslope: number; // per second, between the preceding minimum and the peak (DSP-9 "not a beat")
  amplitude: number; // peak minus the preceding minimum
}

export interface Upstroke {
  onsetIndex: number; // fractional sample index
  footIndex: number; // the preceding minimum
  maxUpslope: number; // per sample
}

/** DSP-7: Elgendi W1 and W2 in samples, each rounded to the nearest odd count so the window centres. */
export function elgendiWindows(rateHz: number): { peakSamples: number; beatSamples: number } {
  const nearestOdd = (samples: number) => 2 * Math.round((samples - 1) / 2) + 1;
  const { peakWindowS, beatWindowS } = DSP_CONFIG.dsp7;
  return { peakSamples: nearestOdd(peakWindowS * rateHz), beatSamples: nearestOdd(beatWindowS * rateHz) };
}

// Centered moving average. At the edges, samples outside the signal count as zero and the sum is still
// divided by the full width, so a beat at the very edge is not boosted by a shorter window. Summed in
// index order, without running sums, so Python can reproduce every comparison exactly.
function centeredMean(squared: Float64Array, width: number): Float64Array {
  const half = (width - 1) / 2;
  const means = new Float64Array(squared.length);
  for (let n = 0; n < squared.length; n++) {
    let sum = 0;
    for (let k = Math.max(0, n - half); k <= Math.min(squared.length - 1, n + half); k++) sum += squared[k]!;
    means[n] = sum / width;
  }
  return means;
}

/** DSP-7: Elgendi et al. 2013 peak indices on a morphology-band signal, as published. */
export function elgendiPeaks(filtered: ArrayLike<number>, rateHz: number): number[] {
  const { peakSamples, beatSamples } = elgendiWindows(rateHz);
  const squared = Float64Array.from(filtered, (value) => (value > 0 ? value * value : 0));
  const maPeak = centeredMean(squared, peakSamples);
  const maBeat = centeredMean(squared, beatSamples);
  let total = 0;
  for (const value of squared) total += value;
  const offset = DSP_CONFIG.dsp7.beta * (total / squared.length);

  const peaks: number[] = [];
  let n = 0;
  while (n < squared.length) {
    if (!(maPeak[n]! > maBeat[n]! + offset)) {
      n++;
      continue;
    }
    const blockStart = n;
    while (n < squared.length && maPeak[n]! > maBeat[n]! + offset) n++;
    // THR2: a block narrower than W1 cannot hold a systolic peak.
    if (n - blockStart < peakSamples) continue;
    let peak = blockStart;
    for (let k = blockStart + 1; k < n; k++) if (filtered[k]! > filtered[peak]!) peak = k;
    peaks.push(peak);
  }
  return peaks;
}

/** DSP-8: tangent at the maximum upslope meets the horizontal line through the preceding minimum. */
export function upstroke(wave: ArrayLike<number>, peakIndex: number, searchStart: number): Upstroke | null {
  let footIndex = searchStart;
  for (let k = searchStart + 1; k <= peakIndex; k++) if (wave[k]! < wave[footIndex]!) footIndex = k;
  // Central differences need a sample on each side, so at least one sample must lie strictly between.
  let steepest = -1;
  let maxUpslope = 0;
  for (let k = footIndex + 1; k < peakIndex; k++) {
    const slope = (wave[k + 1]! - wave[k - 1]!) / 2;
    if (slope > maxUpslope) {
      maxUpslope = slope;
      steepest = k;
    }
  }
  if (steepest < 0) return null;
  const onsetIndex = steepest - (wave[steepest]! - wave[footIndex]!) / maxUpslope;
  return { onsetIndex, footIndex, maxUpslope };
}

// Vertex of the parabola through (−1, before), (0, at), (1, after), taken only at a local maximum, where it
// lies within half a sample. A window maximum on a slope is not a peak of the band: its parabola's vertex
// can be hundreds of samples away (VitalDB, order D.C_TASK-rhythm-windows-negative-interval).
function parabolicOffset(before: number, at: number, after: number): number {
  const curvature = before - 2 * at + after;
  return at >= before && at >= after && curvature < 0 ? (0.5 * (before - after)) / curvature : 0;
}

/** DSP-7/8: beats from one resampled segment's morphology band at 64 Hz (model) and 256 Hz (shape). */
export function detectBeats(model: ResampledSegment, shape: ResampledSegment): DetectedBeat[] {
  const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
  const refineHalf = Math.round(DSP_CONFIG.dsp7.refineHalfWindowS * shapeRateHz);
  const climbHalf = (elgendiWindows(shapeRateHz).peakSamples - 1) / 2;
  const minimumSearch = Math.round(DSP_CONFIG.dsp8.minimumSearchS * shapeRateHz);
  const wave = shape.values;
  const last = wave.length - 1;
  const toSeconds = (index: number) => (shape.firstIndex + index) / shapeRateHz;

  const beats: DetectedBeat[] = [];
  let previousPeak: number | null = null;
  for (const modelPeak of elgendiPeaks(model.values, modelRateHz)) {
    const centre =
      Math.round(((model.firstIndex + modelPeak) / modelRateHz) * shapeRateHz) - shape.firstIndex;
    const from = Math.max(0, centre - refineHalf);
    const to = Math.min(last, centre + refineHalf);
    if (from > to) continue;
    let peak = from;
    for (let k = from + 1; k <= to; k++) if (wave[k]! > wave[peak]!) peak = k;
    // A window maximum on the window's edge with the band still rising beyond it is on a slope: climb to
    // the local maximum it slopes up to (a block that opens just past a broad lobe's top, ADR 0068). At
    // most half of W1 from the candidate: MA_peak averages over W1, so a block can open up to that far from
    // the top of its wave.
    const lowest = Math.max(0, centre - climbHalf);
    const highest = Math.min(last, centre + climbHalf);
    if (peak === from) while (peak > lowest && wave[peak - 1]! > wave[peak]!) peak--;
    if (peak === to) while (peak < highest && wave[peak + 1]! > wave[peak]!) peak++;
    const offset =
      peak > 0 && peak < last ? parabolicOffset(wave[peak - 1]!, wave[peak]!, wave[peak + 1]!) : 0;
    const peakS = toSeconds(peak + offset);
    // Candidates two 64 Hz samples apart can share their window maximum, and nearby ones can climb to the
    // same local maximum: one peak found twice.
    if (beats.length > 0 && peakS <= beats[beats.length - 1]!.peakS) continue;

    const clippedAtStart = previousPeak === null && peak - minimumSearch < 0;
    const found = upstroke(wave, peak, Math.max(previousPeak ?? 0, peak - minimumSearch));
    // A foot on the segment's first sample with the signal still rising there was not observed: the
    // upstroke began before the segment, so its tangent onset would be fabricated.
    const footUnseen = clippedAtStart && found !== null && found.footIndex === 0 && wave[1]! > wave[0]!;
    beats.push({
      peakS,
      onsetS: found && !footUnseen ? toSeconds(found.onsetIndex) : null,
      maxUpslope: found ? found.maxUpslope * shapeRateHz : 0,
      amplitude: found ? wave[peak]! - wave[found.footIndex]! : 0,
    });
    previousPeak = peak;
  }
  return beats;
}
