import type { InconclusiveOutcome } from '@lumen/core';

import { type KeptCapture, keptCapture } from './keptCapture';

// In memory only, like the kept capture: a refused capture is never stored. The outcome belongs to the capture
// it came from, so once a newer capture is kept, a later visit to the Inconclusive screen shows no stale numbers.
let handed: { capture: KeptCapture; outcome: InconclusiveOutcome } | null = null;

export function handOverInconclusive(outcome: InconclusiveOutcome): void {
  const capture = keptCapture();
  handed = capture === null ? null : { capture, outcome };
}

export function handedInconclusive(): InconclusiveOutcome | null {
  return handed !== null && handed.capture === keptCapture() ? handed.outcome : null;
}
