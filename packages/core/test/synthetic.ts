import type { FrameStat, Sample } from '../src';

export interface SyntheticCapture {
  samples: Sample[];
  stats: FrameStat[];
}

// Starts at an arbitrary device-clock value so tests prove times are taken relative to capture start.
const CLOCK_START_NS = 5_000_000_000_000;

// Frames at the given offsets (seconds from capture start); r, g, b come from the frame time.
export function captureAt(
  offsetsS: number[],
  channels: (tS: number) => { r: number; g: number; b: number },
  exposureNs = 8_000_000,
): SyntheticCapture {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const offsetS of offsetsS) {
    const offsetNs = Math.round(offsetS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    // Evaluate at the whole-ns frame time the timebase will see, not the unrounded offset.
    samples.push({ tNs, ...channels(offsetNs / 1e9) });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs });
  }
  return { samples, stats };
}

export function regularOffsets(fps: number, seconds: number): number[] {
  return Array.from({ length: Math.round(fps * seconds) }, (_, k) => k / fps);
}

// Park–Miller minimal standard generator (16807, mod 2³¹ − 1): every product stays below 2⁵³, so it is
// exact in doubles and Python can reproduce it. Deterministic, so failures reproduce.
export function parkMillerUniforms(count: number, seed = 12345): number[] {
  const modulus = 2147483647;
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 16807) % modulus;
    return state / modulus;
  });
}

// Jitter amplitude in seconds, uniform ± amplitude.
export function jitteredOffsets(fps: number, seconds: number, amplitudeS: number): number[] {
  const uniforms = parkMillerUniforms(Math.round(fps * seconds));
  return regularOffsets(fps, seconds).map((offsetS, k) =>
    k === 0 ? 0 : offsetS + (2 * uniforms[k - 1]! - 1) * amplitudeS,
  );
}

export interface SyntheticBeat {
  peakS: number; // systolic peak time, the known answer
  amplitude: number;
}

// Two-Gaussian pulse model: a systolic wave (σ 60 ms) and a dicrotic wave 300 ms later (σ 80 ms) whose
// height is dicroticRatio × the systolic height. Sampled at k / rate from t = 0.
export function ppgWave(beats: SyntheticBeat[], dicroticRatio: number, seconds: number, rateHz: number): number[] {
  const gaussian = (tS: number, centreS: number, sigmaS: number) => Math.exp(-0.5 * ((tS - centreS) / sigmaS) ** 2);
  return Array.from({ length: Math.round(seconds * rateHz) }, (_, k) => {
    const tS = k / rateHz;
    return beats.reduce(
      (sum, { peakS, amplitude }) =>
        sum + amplitude * (gaussian(tS, peakS, 0.06) + dicroticRatio * gaussian(tS, peakS + 0.3, 0.08)),
      0,
    );
  });
}

export function regularBeats(firstS: number, lastS: number, bpm: number): SyntheticBeat[] {
  const beats: SyntheticBeat[] = [];
  for (let peakS = firstS; peakS < lastS; peakS += 60 / bpm) beats.push({ peakS, amplitude: 1 });
  return beats;
}
