import type { FrameStat, Sample } from './capture';
import { DSP_CONFIG } from './config';

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

// Matches numpy.median: the mean of the two middle values for an even count.
function median(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort();
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** DSP-1: native ns timestamps to seconds from capture start, with dropped-frame gaps found. */
export function buildTimebase(samples: Sample[], stats: FrameStat[]): Timebase {
  if (samples.length < 2) throw new RangeError(`need at least 2 frames, got ${samples.length}`);
  if (stats.length !== samples.length)
    throw new RangeError(`${samples.length} samples but ${stats.length} frame stats`);

  const startNs = samples[0]!.tNs;
  const count = samples.length;
  const timebase: Timebase = {
    startNs,
    tS: new Float64Array(count),
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
    // Subtract in ns before scaling so seconds keep sub-microsecond precision late in a capture.
    timebase.tS[i] = (sample.tNs - startNs) / 1e9;
    timebase.r[i] = sample.r;
    timebase.g[i] = sample.g;
    timebase.b[i] = sample.b;
    timebase.exposureNs[i] = stat.exposureNs;
  });

  const intervalsS = new Float64Array(count - 1);
  for (let i = 0; i < count - 1; i++) {
    intervalsS[i] = timebase.tS[i + 1]! - timebase.tS[i]!;
    if (intervalsS[i]! <= 0)
      throw new RangeError(`timestamps must strictly increase; frame ${i + 1} does not`);
  }
  timebase.medianFrameIntervalS = median(intervalsS);
  const droppedLimitS = DSP_CONFIG.dsp1.droppedFrameGapRatio * timebase.medianFrameIntervalS;
  intervalsS.forEach((intervalS, i) => {
    if (intervalS > droppedLimitS) timebase.droppedGapStarts.push(i);
  });
  return timebase;
}
