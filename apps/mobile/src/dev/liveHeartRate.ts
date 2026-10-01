import { DSP_CONFIG, estimateLiveHeartRate, type Sample } from '@lumen/core';

const WINDOW_NS = DSP_CONFIG.liveHr.windowS * 1e9;

export type LiveHeartRate =
  { kind: 'bpm'; bpm: number; snrDb: number } | { kind: 'none' } | { kind: 'error'; reason: string };

// Appends a batch and keeps only core's window (ADR 0027: about the last 10 s), so the buffer stays bounded
// however long the capture runs. Appendix A does not promise that tNs increases, so samples from before the
// last backward clock step are dropped too: they belong to another timeline.
export function keepLiveWindow(window: Sample[], incoming: Sample[]): Sample[] {
  const joined = [...window, ...incoming];
  const newest = joined[joined.length - 1];
  if (!newest) return joined;
  let first = joined.length - 1;
  while (first > 0) {
    const earlier = joined[first - 1]!;
    if (earlier.tNs > joined[first]!.tNs || earlier.tNs < newest.tNs - WINDOW_NS) break;
    first -= 1;
  }
  return first === 0 ? joined : joined.slice(first);
}

// Core throws RangeError when timestamps in the window do not strictly increase (DSP-1); Appendix A does not
// promise they do, so that call shows the error instead of a number. Any other throw is a bug and propagates.
export function readLiveHeartRate(window: Sample[]): LiveHeartRate {
  try {
    const estimate = estimateLiveHeartRate(window);
    return estimate ? { kind: 'bpm', ...estimate } : { kind: 'none' };
  } catch (error) {
    if (error instanceof RangeError) return { kind: 'error', reason: error.message };
    throw error;
  }
}
