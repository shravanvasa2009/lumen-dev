import type { FrameStat, NsSpan, Sample, SqiScores } from '@lumen/core';

// What the live capture hands to the Processing screen: the frames as the module reported them, plus what the
// live session decided about them (ADR 0042's contract gap: the session does not expose these itself).
export interface KeptCapture {
  captureFps: number;
  samples: Sample[];
  stats: FrameStat[];
  motionSpans: NsSpan[];
  coldHandsSpans: NsSpan[];
  sqi: SqiScores | null;
}

// In memory only: a persistent store is a separate task, so a capture does not outlive the app process.
let kept: KeptCapture | null = null;

export function keepCapture(capture: KeptCapture | null): void {
  kept = capture;
}

export function keptCapture(): KeptCapture | null {
  return kept;
}
