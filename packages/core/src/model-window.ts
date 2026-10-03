import { DSP_CONFIG } from './config';
import { sqiModelInput } from './finger-signal';
import type { RejectedSpan } from './live-session';
import { resampleCubic } from './resample';

// Shared by LiveSession and analyzeReading, so the live screen and the saved result reject the same flat
// windows (ADR 0023, ADR 0057).

// The once-per-second check after the one at tS; the first is at live.sqiEveryS.
export function nextModelTickS(tS: number): number {
  const { sqiEveryS } = DSP_CONFIG.live;
  return (Math.floor(tS / sqiEveryS) + 1) * sqiEveryS;
}

// First of frames [0, count) at or after fromS, if the frames from there to frame count − 1 are covered
// (covered[i] = 1) and gap-free; null otherwise or when the capture does not reach back to fromS.
export function usableFrom(
  tS: ArrayLike<number>,
  covered: ArrayLike<number>,
  count: number,
  fromS: number,
): number | null {
  if (count === 0 || tS[0]! > fromS) return null;
  let first = count - 1;
  while (first > 0 && tS[first - 1]! >= fromS) first--;
  if (first > 0) first--; // one frame before fromS, so a spline covers fromS itself
  for (let i = first; i < count; i++) {
    if (!covered[i]) return null;
    if (i > first && tS[i]! - tS[i - 1]! > DSP_CONFIG.dsp2.maxGapS) return null;
  }
  return first;
}

// The SQI-Net window ending at or before frame count − 1 (ADR 0023): 256 points of −R on the 64 Hz grid.
// input is null when the window is flat or not finite: it never reaches the model and counts as rejected.
// Null when the last 4 s are not covered and gap-free, or the reading is not yet 256 grid points long.
export function modelWindowAt(
  tS: Float64Array,
  red: Float64Array,
  covered: ArrayLike<number>,
  count: number,
): { endS: number; input: Float32Array | null } | null {
  const { modelRateHz } = DSP_CONFIG.dsp2;
  const samples = DSP_CONFIG.dsp3.modelWindowS * modelRateHz;
  // Two grid steps of slack so the 64 Hz grid holds 256 points ending at or before the newest frame.
  // Clamped to the first frame, so the first window starts at the reading start (ADR 0057): otherwise
  // [0, 1 s) is in no window and could never be rejected.
  const fromS = Math.max(tS[0]!, tS[count - 1]! - (samples + 1) / modelRateHz);
  const first = usableFrom(tS, covered, count, fromS);
  if (first === null) return null;
  const times = tS.slice(first, count);
  const window = red.slice(first, count);
  const [segment] = resampleCubic(
    times,
    window.map((value) => -value),
    modelRateHz,
  );
  if (!segment || segment.values.length < samples) return null;
  const values = segment.values.slice(-samples);
  const endS = (segment.firstIndex + segment.values.length - 1) / modelRateHz;
  // Flatness is judged on the frames: a spline through equal values can round to tiny wiggles that
  // z-scoring would blow up into noise.
  const flat = window.every((value) => value === window[0]);
  const input = !flat && values.every(Number.isFinite) ? sqiModelInput(values) : null;
  return { endS, input };
}

// ADR 0057: a covered, gap-free run of frames whose red never changes holds no pulse at any length, so
// it is rejected as quality from its first to its last frame, even when it is too short for any window
// (dropouts every few seconds would otherwise keep constant red out of every check). Fed one frame at a
// time by both LiveSession and analyzeReading, so they find the same runs.
export class FlatRuns {
  private readonly closed: RejectedSpan[] = [];
  private startS: number | null = null;
  private lastS = 0;
  private red = 0;
  private flat = false;

  add(tS: number, red: number, covered: boolean): void {
    const continues = covered && this.startS !== null && tS - this.lastS <= DSP_CONFIG.dsp2.maxGapS;
    if (continues) {
      this.lastS = tS;
      this.flat &&= red === this.red;
      return;
    }
    this.closed.push(...this.openSpan());
    this.startS = covered ? tS : null;
    this.lastS = tS;
    this.red = red;
    this.flat = true;
  }

  // Closed runs, then the current one if it is flat so far.
  spans(): RejectedSpan[] {
    return [...this.closed.map((span) => ({ ...span })), ...this.openSpan()];
  }

  // A one-frame run spans no time and is left out.
  private openSpan(): RejectedSpan[] {
    if (this.startS === null || !this.flat || this.lastS === this.startS) return [];
    return [{ startS: this.startS, endS: this.lastS, reason: 'quality' }];
  }
}
