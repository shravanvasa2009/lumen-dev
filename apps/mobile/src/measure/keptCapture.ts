import type { FrameStat, NsSpan, Sample, SqiScores } from '@lumen/core';

// What the live capture hands to the Processing screen: the frames as the module reported them, plus what the
// live session decided about them (ADR 0042's contract gap: the session does not expose these itself).
export interface KeptCapture {
  captureFps: number;
  // The lens the live capture ran on; null when the phone has no torch-capable lens.
  lensId: string | null;
  samples: Sample[];
  stats: FrameStat[];
  motionSpans: NsSpan[];
  coldHandsSpans: NsSpan[];
  sqi: SqiScores | null;
  // Set when the frames came from Demo mode's synthetic recording; such a reading is never saved (§8.5).
  demo?: true;
}

// In memory only: a persistent store is a separate task, so a capture does not outlive the app process.
let kept: KeptCapture | null = null;

export function keepCapture(capture: KeptCapture | null): void {
  kept = capture;
}

export function keptCapture(): KeptCapture | null {
  return kept;
}
