import type { FrameStat, Sample } from './capture';
import { DSP_CONFIG } from './config';
import { median } from './median';

export interface Timebase {
  startNs: number;
  tS: Float64Array; // seconds from the first frame
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  exposureNs: Float64Array;
  medianFrameIntervalS: number;
  droppedGapStarts: number[]; // index of the frame before each dropped-frame gap
}

// DSP-1's time axis alone, for callers that have samples but no frame stats (live HR).
export function secondsFromStart(samples: Sample[]): Float64Array {
  samples.forEach((sample, i) => {
    if (!Number.isFinite(sample.tNs))
      throw new RangeError(`frame ${i}: timestamp ${sample.tNs} is not finite`);
  });
  const startNs = samples[0]!.tNs;
  // Subtract in ns before scaling so seconds keep sub-microsecond precision late in a capture.
  const tS = Float64Array.from(samples, (sample) => (sample.tNs - startNs) / 1e9);
  for (let i = 1; i < tS.length; i++) {
    if (tS[i]! <= tS[i - 1]!) throw new RangeError(`timestamps must strictly increase; frame ${i} does not`);
  }
  return tS;
}

/** DSP-1: native ns timestamps to seconds from capture start, with dropped-frame gaps found. */
export function buildTimebase(samples: Sample[], stats: FrameStat[]): Timebase {
  if (samples.length < 2) throw new RangeError(`need at least 2 frames, got ${samples.length}`);
  if (stats.length !== samples.length)
    throw new RangeError(`${samples.length} samples but ${stats.length} frame stats`);

  const count = samples.length;
  const timebase: Timebase = {
    startNs: samples[0]!.tNs,
    tS: secondsFromStart(samples),
    r: new Float64Array(count),
    g: new Float64Array(count),
    b: new Float64Array(count),
    exposureNs: new Float64Array(count),
    medianFrameIntervalS: 0,
    droppedGapStarts: [],
  };
  samples.forEach((sample, i) => {
    const stat = stats[i]!;
    if (stat.tNs !== sample.tNs)
      throw new RangeError(`frame ${i}: sample at ${sample.tNs} ns but stats at ${stat.tNs} ns`);
    timebase.r[i] = sample.r;
    timebase.g[i] = sample.g;
    timebase.b[i] = sample.b;
    timebase.exposureNs[i] = stat.exposureNs;
  });

  const intervalsS = new Float64Array(count - 1);
  for (let i = 0; i < count - 1; i++) intervalsS[i] = timebase.tS[i + 1]! - timebase.tS[i]!;
  timebase.medianFrameIntervalS = median(intervalsS);
  const droppedLimitS = DSP_CONFIG.dsp1.droppedFrameGapRatio * timebase.medianFrameIntervalS;
  intervalsS.forEach((intervalS, i) => {
    if (intervalS > droppedLimitS) timebase.droppedGapStarts.push(i);
  });
  return timebase;
}
