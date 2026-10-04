import type { KeptCapture } from './keptCapture';

const MIN_FRAMES = 2;

// buildTimebase (DSP-1) needs two frames to have an interval, so readingOutcome never sees fewer: §7 refuses
// the capture here and it is never saved (ADR 0072). A frame with a non-finite value is not too short: DSP-4
// treats it as not covered, so it is only not clean time. A capture whose samples and stats differ in count is
// a broken module, not a short recording, so it is not refused here: analyzeKeptCapture throws and Processing
// reports a failure.
export function isTooShort({ samples, stats }: KeptCapture): boolean {
  return samples.length === stats.length && samples.length < MIN_FRAMES;
}
