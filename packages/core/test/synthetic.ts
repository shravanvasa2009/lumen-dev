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

// Deterministic jitter (a fixed LCG) so failures reproduce; amplitude in seconds, uniform ± amplitude.
export function jitteredOffsets(fps: number, seconds: number, amplitudeS: number): number[] {
  let state = 12345;
  const nextUniform = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return regularOffsets(fps, seconds).map((offsetS, k) =>
    k === 0 ? 0 : offsetS + (2 * nextUniform() - 1) * amplitudeS,
  );
}
