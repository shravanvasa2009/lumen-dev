import type { FrameStat, LiveSession, NsSpan, Sample, SqiScores } from '@lumen/core';

// What the live capture hands to the Processing screen: the frames as the module reported them, plus what the
// live session decided about them (LiveSession.readingInput, H-025).
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

export interface LiveCaptureSource {
  captureFps: number;
  lensId: string | null;
  demo?: true;
  readingInput: LiveSession['readingInput'];
}

// In memory only: a persistent store is a separate task, so a capture does not outlive the app process.
// The session keeps the only copy of the frames. A snapshot is taken when one is asked for and reused until
// more frames arrive, so every caller of a finished capture gets the same object (one analysis, one save).
let build: (() => KeptCapture) | null = null;
let snapshot: KeptCapture | null = null;

export function keepCapture(capture: KeptCapture | null): void {
  build = capture === null ? null : () => capture;
  snapshot = null;
}

export function keepLiveCapture(source: LiveCaptureSource): void {
  const { captureFps, lensId, demo } = source;
  build = () => {
    const { capture, motionSpans, coldHandsSpans, sqi } = source.readingInput();
    return {
      captureFps,
      lensId,
      samples: capture.samples,
      stats: capture.stats,
      motionSpans,
      coldHandsSpans,
      sqi,
      ...(demo ? { demo: true as const } : {}),
    };
  };
  snapshot = null;
}

// The live session took more frames, a status, or an SQI score, so an earlier snapshot is out of date.
export function liveCaptureChanged(): void {
  snapshot = null;
}

export function keptCapture(): KeptCapture | null {
  if (build === null) return null;
  snapshot ??= build();
  return snapshot;
}
