import { DSP_CONFIG } from './config';
import { sqiModelInput } from './finger-signal';
import type { RejectedSpan } from './live-session';
import { isFrameGap, resampleCubic } from './resample';

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

// Covered frames from the one before fromS to frame count − 1. Uncovered frames count as dropped (ADR 0057):
// null when no covered frame reaches back to fromS, or when two neighbouring kept frames, or the newest
// kept frame and frame count − 1, are more than DSP-2's gap limit apart.
function windowFrames(
  tS: ArrayLike<number>,
  covered: ArrayLike<number>,
  count: number,
  fromS: number,
): number[] | null {
  const kept: number[] = [];
  let laterS = tS[count - 1]!;
  for (let i = count - 1; i >= 0; i--) {
    if (!covered[i]) continue;
    if (laterS - tS[i]! > DSP_CONFIG.dsp2.maxGapS) return null;
    kept.push(i);
    laterS = tS[i]!;
    // One frame before fromS, so a spline covers fromS itself; the first frame when the window starts there.
    if (tS[i]! < fromS || (i === 0 && tS[i]! <= fromS)) return kept.reverse();
  }
  return null;
}

// The SQI-Net window ending at or before frame count − 1 (ADR 0023): 256 points of −R on the 64 Hz grid,
// splined across uncovered frames within DSP-2's gap limit. input is null when the window is flat or not
// finite: it never reaches the model and counts as rejected. Null when no such window exists.
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
  const kept = windowFrames(tS, covered, count, fromS);
  if (kept === null) return null;
  const window = Float64Array.from(kept, (i) => red[i]!);
  const [segment] = resampleCubic(
    Float64Array.from(kept, (i) => tS[i]!),
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

// ADR 0057: a check with 4 s of reading behind it but no window (bad frames past DSP-2's gap limit)
// leaves those 4 s unscored. Once SQI-Net runs, they count as not clean.
export function unscoredSpan(tS: ArrayLike<number>, count: number): RejectedSpan | null {
  const tickS = tS[count - 1]!;
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  if (tickS - tS[0]! < windowS) return null;
  return { startS: tickS - windowS, endS: tickS, reason: 'quality' };
}

// ADR 0057: constant red holds no pulse. A covered, gap-free run of frames whose red never changes is
// rejected as quality from its first to its last frame at any length, so dropouts every few seconds
// cannot keep it out of every window. Inside a longer run, a stretch of exactly equal red at least
// live.minFlatS long is rejected too. Fed one frame at a time by both LiveSession and analyzeReading, so
// they find the same spans.
export class FlatRuns {
  private readonly closed: RejectedSpan[] = [];
  private runStartS: number | null = null; // null outside a covered run
  private runFlat = false;
  private stretchStartS = 0; // first frame of the current equal-red stretch
  private lastS = 0;
  private red = 0;

  add(tS: number, red: number, covered: boolean): void {
    const continues = covered && this.runStartS !== null && !isFrameGap(this.lastS, tS);
    if (continues && red === this.red) {
      this.lastS = tS;
      return;
    }
    if (continues) {
      this.closed.push(...this.stretchSpan());
      this.runFlat = false;
    } else {
      this.closed.push(...this.openSpan());
      this.runStartS = covered ? tS : null;
      this.runFlat = true;
    }
    this.stretchStartS = tS;
    this.lastS = tS;
    this.red = red;
  }

  // Closed spans, then the current run if it is flat so far or its current stretch is long enough.
  spans(): RejectedSpan[] {
    return [...this.closed.map((span) => ({ ...span })), ...this.openSpan()];
  }

  private openSpan(): RejectedSpan[] {
    if (this.runStartS === null) return [];
    // A one-frame run spans no time and is left out.
    if (this.runFlat) return this.lastS > this.runStartS ? [this.spanFrom(this.runStartS)] : [];
    return this.stretchSpan();
  }

  private stretchSpan(): RejectedSpan[] {
    return this.lastS - this.stretchStartS >= DSP_CONFIG.live.minFlatS
      ? [this.spanFrom(this.stretchStartS)]
      : [];
  }

  private spanFrom(startS: number): RejectedSpan {
    return { startS, endS: this.lastS, reason: 'quality' };
  }
}
