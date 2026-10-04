import { DSP_CONFIG } from './config';
import { sqiModelInput } from './finger-signal';
import type { RejectedSpan } from './live-session';
import { HALF_NS_S, isFrameGap, resampleCubic } from './resample';

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
    if (i > first && isFrameGap(tS[i - 1]!, tS[i]!)) return null;
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
    if (isFrameGap(tS[i]!, laterS)) return null;
    kept.push(i);
    laterS = tS[i]!;
    // One frame before fromS, so a spline covers fromS itself; the first frame when the window starts there.
    if (tS[i]! < fromS || (i === 0 && tS[i]! <= fromS)) return kept.reverse();
  }
  return null;
}

// The most intervals between neighbouring frames [first, count) up to endS longer than longerThanS that
// fit in one closed span of live.subWindowS, from the first one's start to the last one's end, with
// DSP-2's half-ns allowance.
function intervalsInSpan(
  tS: ArrayLike<number>,
  first: number,
  count: number,
  endS: number,
  longerThanS: number,
): number {
  const { subWindowS } = DSP_CONFIG.live;
  const startsS: number[] = [];
  let oldest = 0;
  let most = 0;
  for (let i = first + 1; i < count && tS[i]! <= endS; i++) {
    if (tS[i]! - tS[i - 1]! <= longerThanS + HALF_NS_S) continue;
    startsS.push(tS[i - 1]!);
    while (tS[i]! - startsS[oldest]! > subWindowS + HALF_NS_S) oldest++;
    most = Math.max(most, startsS.length - oldest);
  }
  return most;
}

// ADR 0077: under live.minEffectiveFps when frames [0, count) delivered in [endS − dsp3.modelWindowS, endS],
// covered or not, number fewer than minEffectiveFps × the window; when any span of live.subWindowS that
// starts on one of them and ends inside the window holds fewer than live.minSubWindowFps × that span, ends
// included as in the window count; or when one such span holds two intervals between neighbouring frames
// longer than live.maxFrameGapS (implementation note 4), or live.maxSparseIntervalsPerS longer than
// live.sparseIntervalS (note 5). The 1 s count stops a fast burst paying for a sparse rest of the window.
// The interval tests stop clumps of frames standing in for samples of a fast pulse: a run of long
// intervals is a stretch sampled too sparsely for the pulse (note 4) or its harmonics (note 5), while one
// lone interval up to DSP-2's gap limit is splined over as DSP-2 allows, so random drops of 3 frames in a
// row at 30 fps still pass. Every such span must also hold live.minDistinctSamplesPerS distinct sample times
// (note 6): Nyquist for the 2nd harmonic of the fastest rate reported, so no arrangement of clustered
// frames samples the pulse more sparsely than its shape needs. No run of sparse sample times may outlast
// live.maxSparseRunS either (note 7, longSparseRun).
function underEffectiveFps(tS: ArrayLike<number>, count: number, endS: number): boolean {
  const {
    minEffectiveFps,
    minSubWindowFps,
    subWindowS,
    maxFrameGapS,
    sparseIntervalS,
    maxSparseIntervalsPerS,
    minDistinctSamplesPerS,
  } = DSP_CONFIG.live;
  const startS = endS - DSP_CONFIG.dsp3.modelWindowS;
  let first = count;
  let frames = 0;
  for (let i = count - 1; i >= 0 && tS[i]! >= startS; i--) {
    first = i;
    if (tS[i]! <= endS) frames++;
  }
  if (frames < minEffectiveFps * DSP_CONFIG.dsp3.modelWindowS) return true;
  if (intervalsInSpan(tS, first, count, endS, maxFrameGapS) >= 2) return true;
  if (intervalsInSpan(tS, first, count, endS, sparseIntervalS) >= maxSparseIntervalsPerS) return true;
  const spanFrames = Math.ceil(minSubWindowFps * subWindowS);
  for (let i = first; i < count && tS[i]! + subWindowS <= endS; i++) {
    const last = i + spanFrames - 1;
    if (last >= count || !(tS[last]! <= tS[i]! + subWindowS)) return true;
    if (distinctSamples(tS, i, count, tS[i]! + subWindowS) < minDistinctSamplesPerS * subWindowS) return true;
  }
  return longSparseRun(tS, first, count, endS);
}

// ADR 0077 implementation note 7 (red team PR #171 round 9, M): sample times more than 1 / (2 × the 2nd
// harmonic of rules.fastRegularBpm's top) apart (68 ms at 220 bpm) leave that harmonic under-sampled. A run
// of them may last at most live.maxSparseRunS, so a burst of close frames cannot pay for a sparse rest of
// the second in note 6's count. Sample times as note 6 (distinctSampleS); one shorter spacing ends a run.
function longSparseRun(tS: ArrayLike<number>, first: number, count: number, endS: number): boolean {
  const { distinctSampleS, maxSparseRunS } = DSP_CONFIG.live;
  const nyquistS = 60 / (2 * 2 * DSP_CONFIG.rules.fastRegularBpm[1]!);
  let lastS = tS[first]!;
  let runS = 0;
  for (let k = first + 1; k < count && tS[k]! <= endS; k++) {
    const spacingS = tS[k]! - lastS;
    if (spacingS < distinctSampleS - HALF_NS_S) continue;
    lastS = tS[k]!;
    runS = spacingS > nyquistS + HALF_NS_S ? runS + spacingS : 0;
    if (runS > maxSparseRunS + HALF_NS_S) return true;
  }
  return false;
}

// Sample times in [tS[i], untilS]: a frame counts only live.distinctSampleS or more after the last counted
// one (with DSP-2's half-ns allowance), so frames delivered in a cluster sample the pulse once (note 6).
function distinctSamples(tS: ArrayLike<number>, i: number, count: number, untilS: number): number {
  const { distinctSampleS } = DSP_CONFIG.live;
  let samples = 1;
  let lastS = tS[i]!;
  for (let k = i + 1; k < count && tS[k]! <= untilS + HALF_NS_S; k++) {
    if (tS[k]! - lastS < distinctSampleS - HALF_NS_S) continue;
    samples++;
    lastS = tS[k]!;
  }
  return samples;
}

// The SQI-Net window ending at or before frame count − 1 (ADR 0023): 256 points of −R on the 64 Hz grid,
// splined across uncovered frames within DSP-2's gap limit. input is null when the window is flat, not
// finite, or under live.minEffectiveFps (ADR 0077, underEffectiveFps): it never reaches the model and
// counts as rejected. Null when no such window exists.
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
  const sparse = underEffectiveFps(tS, count, endS);
  const input = !flat && !sparse && values.every(Number.isFinite) ? sqiModelInput(values) : null;
  return { endS, input };
}

// ADR 0057: a check with 4 s of reading behind it but no window (bad frames past DSP-2's gap limit)
// leaves unscored everything since the end of the newest window that formed (sinceS), or since the first
// frame if none has: those seconds are in no window. Seconds inside a formed window stay outside it, so a
// stall after the countdown completes cannot take back counted seconds. Once SQI-Net runs, the span is
// not clean.
export function unscoredSpan(
  tS: ArrayLike<number>,
  count: number,
  sinceS: number | null,
): RejectedSpan | null {
  const tickS = tS[count - 1]!;
  if (tickS - tS[0]! < DSP_CONFIG.dsp3.modelWindowS) return null;
  const startS = sinceS ?? tS[0]!;
  return startS < tickS ? { startS, endS: tickS, reason: 'quality' } : null;
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
