import type { KeptCapture } from './keptCapture';

const MIN_FRAMES = 2;

export type CaptureRefusal = 'tooShort';

// buildTimebase (DSP-1) needs two frames to have an interval. Fewer is a recording nobody can measure: §7
// refuses it, and a refused capture is not a reading and is never saved (ADR 0072). A frame with a
// non-finite value is not refused: DSP-4 treats it as not covered, so it is only not clean time. A capture
// whose samples and stats differ in count is a broken module, not a short recording, so it is not refused
// here: analyzeKeptCapture throws and Processing reports a failure.
// Interim check: #171's readingOutcome() replaces it.
export function refusalOf({ samples, stats }: KeptCapture): CaptureRefusal | null {
  if (samples.length !== stats.length) return null;
  return samples.length < MIN_FRAMES ? 'tooShort' : null;
}
