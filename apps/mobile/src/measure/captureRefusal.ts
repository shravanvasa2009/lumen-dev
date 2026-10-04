import type { KeptCapture } from './keptCapture';

const MIN_FRAMES = 2;

export type CaptureRefusal = 'tooShort' | 'notFinite';

const finiteNumbers = (values: number[]): boolean => values.every(Number.isFinite);

// buildTimebase (DSP-1) needs two frames to have an interval. Fewer, or a value that is not a number, is a
// recording nobody can measure: §7 refuses it, and a refused capture is not a reading and is never saved
// (ADR 0072). A capture whose samples and stats differ in count is a broken module, not a short recording,
// so it is not refused here: analyzeKeptCapture throws and Processing reports a failure.
// Interim check: #171's readingOutcome() replaces it.
export function refusalOf({ samples, stats }: KeptCapture): CaptureRefusal | null {
  if (samples.length !== stats.length) return null;
  if (samples.length < MIN_FRAMES) return 'tooShort';
  const finite =
    samples.every((sample) => finiteNumbers([sample.tNs, sample.r, sample.g, sample.b])) &&
    stats.every((stat) => finiteNumbers([stat.tNs, stat.spatialStdR, stat.clipFrac, stat.exposureNs]));
  return finite ? null : 'notFinite';
}
