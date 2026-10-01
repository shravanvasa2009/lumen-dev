import type { Sample } from './capture';
import { DSP_CONFIG } from './config';
import { resampleCubic } from './resample';
import { secondsFromStart } from './timebase';

// The M0 proof's pulseSpectrum (scripts/proof/m0.mjs) on a DSP-2 64 Hz grid; ADR 0027. Not DSP-11.
const { windowS, minSegmentS, detrendHalfWidthS, scanBandHz, scanStepHz, minBpm, maxBpm, minSnrDb } =
  DSP_CONFIG.liveHr;
const RATE_HZ = DSP_CONFIG.dsp2.modelRateHz;
const DETREND_HALF_WIDTH = Math.round(detrendHalfWidthS * RATE_HZ);
const BIN_COUNT = Math.round((scanBandHz[1]! - scanBandHz[0]!) / scanStepHz) + 1;
const binHz = Float64Array.from({ length: BIN_COUNT }, (_, j) => scanBandHz[0]! + j * scanStepHz);
// Each bin's phasor turns by 2π·f/rate per sample; rotating it avoids a cos and sin per sample.
const stepCos = binHz.map((hz) => Math.cos((2 * Math.PI * hz) / RATE_HZ));
const stepSin = binHz.map((hz) => Math.sin((2 * Math.PI * hz) / RATE_HZ));

// Reused across calls (once a second); the window and buffers change only when the segment length does.
const binPower = new Float64Array(BIN_COUNT);
const sortedPower = new Float64Array(BIN_COUNT);
let hann = new Float64Array(0);
let prefixSum = new Float64Array(1);
let tapered = new Float64Array(0);

function fitBuffersTo(length: number): void {
  if (hann.length === length) return;
  // The proof's Hann window: 0.5 − 0.5·cos(2πk/(n − 1)), zero at both ends.
  hann = Float64Array.from({ length }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (length - 1)));
  prefixSum = new Float64Array(length + 1);
  tapered = new Float64Array(length);
}

// Subtracts the mean over [i − half, i + half), clipped to the signal, as the proof does, then applies
// the Hann window.
function detrendAndTaper(ppg: Float64Array): void {
  const length = ppg.length;
  for (let i = 0; i < length; i++) prefixSum[i + 1] = prefixSum[i]! + ppg[i]!;
  for (let i = 0; i < length; i++) {
    const from = Math.max(0, i - DETREND_HALF_WIDTH);
    const to = Math.min(length, i + DETREND_HALF_WIDTH);
    const mean = (prefixSum[to]! - prefixSum[from]!) / (to - from);
    tapered[i] = (ppg[i]! - mean) * hann[i]!;
  }
}

function scanPowers(length: number): void {
  for (let j = 0; j < BIN_COUNT; j++) {
    const turnCos = stepCos[j]!;
    const turnSin = stepSin[j]!;
    let cos = 1;
    let sin = 0;
    let re = 0;
    let im = 0;
    for (let k = 0; k < length; k++) {
      re += tapered[k]! * cos;
      im -= tapered[k]! * sin;
      const nextCos = cos * turnCos - sin * turnSin;
      sin = sin * turnCos + cos * turnSin;
      cos = nextCos;
    }
    binPower[j] = re * re + im * im;
  }
}

/** Lab-screen pulse rate from the last 10 s of samples by the M0 proof's spectral method, or null. */
export function estimateLiveHeartRate(samples: Sample[]): { bpm: number; snrDb: number } | null {
  if (samples.length < 2) return null;
  const windowStartNs = samples[samples.length - 1]!.tNs - windowS * 1e9;
  let first = samples.length - 1;
  while (first > 0 && samples[first - 1]!.tNs >= windowStartNs) first--;
  const recent = samples.slice(first);
  if (recent.length < 2) return null;

  // DSP-3: ppg = −R, so the pulse rises with blood volume. DSP-2 splits wherever frames are > 150 ms apart.
  const negatedRed = Float64Array.from(recent, (sample) => -sample.r);
  // resampleCubic throws on a non-finite value; a bad red frame means no number for this call, not a throw.
  if (!negatedRed.every(Number.isFinite)) return null;
  const segments = resampleCubic(secondsFromStart(recent), negatedRed, RATE_HZ);
  if (segments.length === 0) return null;
  // On a tie, the later segment is the more current one.
  const ppg = segments.reduce((longest, segment) =>
    segment.values.length >= longest.values.length ? segment : longest,
  ).values;
  if ((ppg.length - 1) / RATE_HZ < minSegmentS) return null;
  // A flat segment (finger off, red clipped) has no pulse, but the moving-mean detrend rounds it into
  // noise (up to ~2e-15 at −0.0737) whose spectrum can pass the 6 dB limit (ADR 0027).
  if (ppg.every((value) => value === ppg[0])) return null;

  fitBuffersTo(ppg.length);
  detrendAndTaper(ppg);
  scanPowers(ppg.length);

  let peak = 0;
  for (let j = 1; j < BIN_COUNT; j++) if (binPower[j]! > binPower[peak]!) peak = j;
  sortedPower.set(binPower);
  sortedPower.sort();
  const snrDb = 10 * Math.log10(binPower[peak]! / sortedPower[BIN_COUNT >> 1]!);
  const bpm = binHz[peak]! * 60;
  // Written so a NaN SNR (0/0, all powers zero) fails too.
  if (!(snrDb >= minSnrDb) || bpm < minBpm || bpm > maxBpm) return null;
  return { bpm, snrDb };
}
