import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  type CaptureStatus,
  type LiveSession,
  type ReadingContext,
  type RejectedSpan,
} from '../../src';
import { captureAt, jitteredOffsets, regularOffsets, type SyntheticCapture } from '../synthetic';
import { flatRed, sinePulse, type Channels } from './attacks';

// Red team for ADR 0057: for any frame stream, the live session's rejected spans and clean seconds must
// equal analyzeReading's on readingInput(). Where frames are flat, the attack also checks they are rejected.

const SQI_THRESHOLD = 0.5;
const WINDOW_S = DSP_CONFIG.dsp3.modelWindowS;
const GRID_S = 1 / DSP_CONFIG.dsp2.modelRateHz;
// One 8-bit step of a 0..1 channel mean.
const LSB = 1 / 255;

const still: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 60,
  droppedFrac: 0,
};

interface ReplayOptions {
  captureFps?: number;
  moving?: (tS: number) => boolean;
  // A stand-in SQI-Net score for each new sqiWindow, as the app would call setSqi; none when omitted.
  score?: (endS: number) => number;
  // Called after each batch with the time of its last frame.
  afterBatch?: (session: LiveSession, lastS: number) => void;
}

const secondsOf = (tNs: number, capture: SyntheticCapture) => (tNs - capture.samples[0]!.tNs) / 1e9;

// 100 ms batches and a 4 Hz status, as the capture module sends them.
function replay(capture: SyntheticCapture, options: ReplayOptions = {}): LiveSession {
  const session = createLiveSession({
    captureFps: options.captureFps ?? 60,
    sqiThreshold: SQI_THRESHOLD,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  let nextStatusS = 0;
  let scoredEndS: number | null = null;
  for (let start = 0; start < capture.samples.length;) {
    const batchStartS = secondsOf(capture.samples[start]!.tNs, capture);
    let end = start + 1;
    while (end < capture.samples.length && secondsOf(capture.samples[end]!.tNs, capture) < batchStartS + 0.1)
      end++;
    session.pushSamples({
      samples: capture.samples.slice(start, end),
      stats: capture.stats.slice(start, end),
    });
    const lastS = secondsOf(capture.samples[end - 1]!.tNs, capture);
    while (nextStatusS <= lastS) {
      session.pushStatus({ ...still, motionRms: options.moving?.(nextStatusS) ? 0.2 : 0 });
      nextStatusS += 0.25;
    }
    const window = session.sqiWindow;
    if (options.score && window && window.endS !== scoredEndS) {
      scoredEndS = window.endS;
      session.setSqi(window.endS, options.score(window.endS));
    }
    options.afterBatch?.(session, lastS);
    start = end;
  }
  return session;
}

function contextOf(
  captureFps: number,
  spans: Pick<ReadingContext, 'motionSpans' | 'coldHandsSpans' | 'sqi'>,
): ReadingContext {
  return {
    captureFps,
    tier: 'full',
    mode: 'full',
    restTimerDone: true,
    recordedAt: null,
    validationRhythmLabel: null,
    ...spans,
  };
}

function savedFrom(session: LiveSession, captureFps = 60) {
  const { capture, ...spans } = session.readingInput();
  return analyzeReading(capture, contextOf(captureFps, spans));
}

// The ADR 0057 invariant: identical spans, and the same true clean seconds.
function expectParity(session: LiveSession, captureFps = 60): RejectedSpan[] {
  const saved = savedFrom(session, captureFps);
  expect(saved.rejectedSpans).toEqual(session.rejectedSpans);
  expect(saved.cleanSeconds).toBe(cleanSeconds(0, saved.durationS, session.rejectedSpans));
  return saved.rejectedSpans;
}

const qualitySpans = (spans: RejectedSpan[]) => spans.filter((span) => span.reason === 'quality');

// Pulse outside [fromS, toS), exactly constant red inside.
const flatBetween =
  (fromS: number, toS: number): Channels =>
  (tS) =>
    tS >= fromS && tS < toS ? flatRed(0.6)(tS) : sinePulse(72)(tS);

// Frame offsets with every frame in [fromS, toS) removed.
const withGap = (offsetsS: number[], fromS: number, toS: number) =>
  offsetsS.filter((offsetS) => offsetS < fromS || offsetS >= toS);

// Seconds of [fromS, toS) not inside any of the spans.
const uncoveredIn = (spans: RejectedSpan[], fromS: number, toS: number) => cleanSeconds(fromS, toS, spans);

// Checks run once per second on the window ending at the newest frame, so a flat run is rejected from
// about 1 s after it starts (the first window holds one frame before it) to the last check inside it.
describe('red team: flat windows next to a dropped-frame gap (ADR 0057)', () => {
  // 30 fps; a 300 ms dropout at 10 s.
  const offsets = withGap(regularOffsets(30, 30), 10, 10.3);

  it('flat right after a 300 ms gap: live and saved agree; rejected from the first gap-free window', () => {
    const session = replay(captureAt(offsets, flatBetween(10.3, 20)));
    const spans = expectParity(session);
    // The first window without the gap ends at the 15 s check.
    expect(uncoveredIn(spans, 11.1, 19)).toBe(0);
  });

  it('flat right before a 300 ms gap: live and saved agree; rejected up to the last check before it', () => {
    const session = replay(captureAt(offsets, flatBetween(2, 10)));
    expect(uncoveredIn(expectParity(session), 3.1, 9)).toBe(0);
  });

  it('a gap of exactly 150 ms beside a flat run: live and saved agree', () => {
    // 30 fps frames, then the next frame 150 ms later (whole ns): a DSP-2 gap only above 150 ms.
    const before = regularOffsets(30, 10);
    const after = regularOffsets(30, 10).map((offsetS) => before.at(-1)! + 0.15 + offsetS);
    expectParity(replay(captureAt([...before, ...after], flatBetween(6, 20))));
  });

  // Found by red team. Flat red at 30 fps for 30 s with a 200 ms dropout every 3 s (at 3, 6, … 27 s)
  // leaves no gap-free 4 s window, so neither the flat check, SQI-Net, nor the cold-hands check (which
  // also needs 4 s gap-free) ever runs. Observed: no rejected spans, 29.97 of 29.97 s clean.
  // Expected: constant red is not clean signal just because dropouts split it.
  it('flat red with a 200 ms dropout every 3 s (30 fps, 30 s) is not counted as clean', () => {
    let gappy = regularOffsets(30, 30);
    for (let gapS = 3; gapS < 30; gapS += 3) gappy = withGap(gappy, gapS, gapS + 0.2);
    const session = replay(captureAt(gappy, flatRed(0.6)));
    expect(cleanSeconds(0, gappy.at(-1)!, session.rejectedSpans)).toBeLessThan(gappy.at(-1)! / 2);
  });
});

describe('red team: flat windows at the reading edges', () => {
  // Found by red team. The first window needs 4 s plus two 64 Hz steps of frames, so the 4 s check has
  // none and the first window is [1, 5] at the 5 s check: [0, 1) of a reading is never in any window and
  // can never be rejected as flat (or by SQI-Net). 60 fps, flat red 0–8 s then a 72 bpm pulse.
  // Observed: 1.0 s of the flat start counted clean, live and saved alike. Expected: under 0.05 s.
  it('flat from the first frame: the flat start is not counted clean', () => {
    const session = replay(captureAt(regularOffsets(60, 20), flatBetween(0, 8)));
    expect(uncoveredIn(expectParity(session), 0, 7)).toBeLessThan(0.05);
  });

  it('flat to the last frame: live and saved agree; flat (then cold hands) covers the end', () => {
    const session = replay(captureAt(regularOffsets(60, 20), flatBetween(13, 99)));
    const spans = expectParity(session);
    expect(uncoveredIn(spans, 14.1, spans.at(-1)!.endS)).toBe(0);
  });

  // Found by red team (reading.ts, before this PR, reached through readingInput). With no beat detected,
  // rhythmInputs hands rhythmWindows 0 intervals and 0 beat flags, and it throws "RangeError: 0 intervals
  // need 1 beat flags, got 0". Any capture with no beat does this: flat red, a finger never placed, or a
  // reading shorter than dsp7.minSegmentS (2 s). Expected: analyzeReading returns the live spans and no
  // heart rate, as for any other unusable reading.
  it.each([
    ['20 s of flat red at 60 fps', regularOffsets(60, 20), flatRed(0.6)],
    ['3.5 s of flat red at 60 fps (shorter than one window)', regularOffsets(60, 3.5), flatRed(0.6)],
    ['20 s with the finger never placed', regularOffsets(60, 20), () => ({ r: 0.2, g: 0.3, b: 0.3 })],
    ['1.5 s of a 72 bpm pulse at 60 fps', regularOffsets(60, 1.5), sinePulse(72)],
  ])('%s: analyzeReading returns the live spans and no heart rate', (_label, offsetsS, channels) => {
    const session = replay(captureAt(offsetsS, channels));
    expectParity(session);
    expect(savedFrom(session).heartRateBpm).toBeNull();
  });

  it('a reading of one frame: analyzeReading refuses readingInput() with a RangeError', () => {
    const session = replay(captureAt([0], sinePulse(72)));
    expect(session.rejectedSpans).toEqual([]);
    expect(() => savedFrom(session)).toThrow(RangeError);
  });
});

describe('red team: covered and uncovered frames inside one window', () => {
  // Finger off (dark red, bright green) before onS, then flat red.
  const fingerOnAt =
    (onS: number): Channels =>
    (tS) =>
      tS < onS ? { r: 0.2, g: 0.3, b: 0.3 } : flatRed(0.6)(tS);

  it.each([5.5, 5.99, 6.0])(
    'finger lands flat at %s s: live and saved agree, and flat is rejected 4 s later',
    (onS) => {
      const session = replay(captureAt(jitteredOffsets(60, 20, 0.002), fingerOnAt(onS)));
      const spans = expectParity(session);
      expect(spans.some((span) => span.reason === 'coverage')).toBe(true);
      expect(uncoveredIn(qualitySpans(spans), onS + 4.1, 19)).toBe(0);
    },
  );

  it('finger lifts for one frame inside a flat stretch: live and saved agree', () => {
    const channels: Channels = (tS) =>
      Math.abs(tS - 10) < 0.01 ? { r: 0.2, g: 0.3, b: 0.3 } : flatRed(0.6)(tS);
    expectParity(replay(captureAt(regularOffsets(60, 20), channels)));
  });
});

describe('red team: frame timestamps the session must refuse', () => {
  const capture = captureAt(regularOffsets(60, 2), sinePulse(72));

  it.each([
    ['a duplicate timestamp', (tNs: number[]) => tNs.map((t, i) => (i === 50 ? tNs[49]! : t))],
    ['a timestamp that steps back 1 ns', (tNs: number[]) => tNs.map((t, i) => (i === 50 ? tNs[49]! - 1 : t))],
  ])('%s: live and analyzeReading both throw a RangeError', (_label, rewrite) => {
    const tNs = rewrite(capture.samples.map((sample) => sample.tNs));
    const samples = capture.samples.map((sample, i) => ({ ...sample, tNs: tNs[i]! }));
    const stats = capture.stats.map((stat, i) => ({ ...stat, tNs: tNs[i]! }));
    expect(() =>
      analyzeReading({ samples, stats }, contextOf(60, { motionSpans: [], coldHandsSpans: [], sqi: null })),
    ).toThrow(RangeError);
    const session = createLiveSession({
      captureFps: 60,
      sqiThreshold: SQI_THRESHOLD,
      perfusionFloorPct: 0.2,
    });
    expect(() => session.pushSamples({ samples, stats })).toThrow(RangeError);
  });

  it('a duplicate timestamp across two batches is refused and leaves the session as it was', () => {
    const session = createLiveSession({
      captureFps: 60,
      sqiThreshold: SQI_THRESHOLD,
      perfusionFloorPct: 0.2,
    });
    session.pushSamples({ samples: capture.samples.slice(0, 60), stats: capture.stats.slice(0, 60) });
    const before = session.readingInput();
    const repeat = { samples: capture.samples.slice(59, 70), stats: capture.stats.slice(59, 70) };
    expect(() => session.pushSamples(repeat)).toThrow(RangeError);
    expect(session.readingInput()).toEqual(before);
  });
});

describe('red team: one non-finite channel value', () => {
  // 20 s of 72 bpm pulse at 60 fps with one bad frame at 10 s.
  const badFrameAt10 =
    (patch: Partial<{ r: number; g: number; b: number }>): Channels =>
    (tS) =>
      Math.abs(tS - 10) < 1e-6 ? { ...sinePulse(72)(tS), ...patch } : sinePulse(72)(tS);

  // Found by red team. DSP-4 counts a NaN-red frame as uncovered, so the live session takes it, but
  // analyzeReading resamples the whole capture (beatSegments → resampleCubic) and throws on it. Expected:
  // the saved reading rejects the frame as the live screen did, instead of failing the whole reading.
  it.each([
    ['red NaN', { r: NaN }],
    ['green NaN', { g: NaN }],
    ['red −Infinity', { r: -Infinity }],
  ])('%s in one frame: the session takes it, and analyzeReading gives the same spans', (_label, patch) => {
    const session = replay(captureAt(regularOffsets(60, 20), badFrameAt10(patch)));
    const spans = expectParity(session);
    expect(spans.some((span) => span.reason === 'coverage' && span.startS <= 10 && span.endS > 10)).toBe(
      true,
    );
  });

  // Found by red team. +Infinity red passes DSP-4 (Infinity ≥ 2 (G + B)), so the frame counts as covered,
  // and the next once-per-second check throws from resampleCubic inside pushSamples, after the frames
  // before it in the batch were already added. Expected: pushSamples does not throw on a frame value;
  // the window is rejected as not finite (ADR 0023) and the session keeps going.
  it('red +Infinity in one frame: pushSamples keeps going and the window is rejected', () => {
    const session = replay(captureAt(regularOffsets(60, 20), badFrameAt10({ r: Infinity })));
    const spans = expectParity(session);
    expect(spans.some((span) => span.startS <= 10 && span.endS > 10)).toBe(true);
  });
});

describe('red team: nearly flat windows are not flat', () => {
  // 20 s at 60 fps; red constant 0.6 from 5 s to 15 s except for the given offset.
  const nearlyFlat =
    (offset: (tS: number) => number): Channels =>
    (tS) =>
      tS >= 5 && tS < 15 ? { ...flatRed(0.6)(tS), r: 0.6 + offset(tS) } : sinePulse(72)(tS);

  // The model inputs of every window whose 4 s contain atS, as the app would read them after each batch.
  const inputsAround = (atS: number) => {
    const inputs: Float32Array[] = [];
    const afterBatch = (live: LiveSession) => {
      const window = live.sqiWindow;
      if (window && window.endS - WINDOW_S < atS && window.endS > atS) inputs.push(window.input);
    };
    return { inputs, afterBatch };
  };
  const spansAcross = (spans: RejectedSpan[], atS: number) =>
    qualitySpans(spans).filter((span) => span.startS < atS && span.endS > atS);

  it.each([
    ['one LSB step at 10 s', (tS: number) => (tS >= 10 ? LSB : 0)],
    ['one frame one LSB high at 10 s', (tS: number) => (Math.abs(tS - 10) < 0.005 ? LSB : 0)],
    ['1e-12 noise', (tS: number) => 1e-12 * Math.sin(1000 * tS)],
  ])('%s: windows across 10 s reach the model with finite input; live and saved agree', (_label, offset) => {
    const watcher = inputsAround(10);
    const session = replay(captureAt(regularOffsets(60, 20), nearlyFlat(offset)), {
      afterBatch: watcher.afterBatch,
    });
    expect(spansAcross(expectParity(session), 10)).toEqual([]);
    expect(watcher.inputs.length).toBeGreaterThanOrEqual(3);
    for (const input of watcher.inputs) expect(input.every(Number.isFinite)).toBe(true);
  });

  it('flat frames in the window and one LSB higher just before it: finite input; live and saved agree', () => {
    // Frames before 6 s are one LSB higher. The window ending at 10 s starts one frame before 5.98 s, so
    // its spline carries the step at its left edge.
    const step: Channels = (tS) => ({ ...flatRed(0.6)(tS), r: tS < 6 ? 0.6 + LSB : 0.6 });
    const watcher = inputsAround(8);
    const session = replay(captureAt(regularOffsets(60, 12), step), { afterBatch: watcher.afterBatch });
    expectParity(session);
    for (const input of watcher.inputs) expect(input.every(Number.isFinite)).toBe(true);
  });
});

describe('red team: frame rates and jitter', () => {
  // Pulse with flat 8–14 s, finger off 20–21 s, a 250 ms dropout at 26 s, and motion 30–31 s.
  const mixed = (fps: number, offsets: number[]) =>
    replay(
      captureAt(withGap(offsets, 26, 26.25), (tS) =>
        tS >= 20 && tS < 21 ? { r: 0.2, g: 0.3, b: 0.3 } : flatBetween(8, 14)(tS),
      ),
      { captureFps: fps, moving: (tS) => tS >= 30 && tS < 31, score: (endS) => (endS % 3 < 1 ? 0.2 : 0.9) },
    );

  it.each([30, 60, 120, 240])('%i fps: live and saved spans agree, flat run rejected', (fps) => {
    const spans = expectParity(mixed(fps, regularOffsets(fps, 40)), fps);
    expect(uncoveredIn(qualitySpans(spans), 8, 13)).toBe(0);
  });

  it.each([
    [30, 0.004],
    [60, 0.004],
    [120, 0.002],
    [240, 0.001],
  ])('%i fps with ±%f s jitter: live and saved spans agree', (fps, jitterS) => {
    expectParity(mixed(fps, jitteredOffsets(fps, 40, jitterS)), fps);
  });

  it('frame rate halving mid-reading (60 → 30 fps at 15 s): live and saved spans agree', () => {
    const offsets = [...regularOffsets(60, 15), ...regularOffsets(30, 25).map((offsetS) => 15 + offsetS)];
    expectParity(mixed(60, offsets));
  });
});

describe('red team: setSqi and readingInput calls', () => {
  const capture = captureAt(jitteredOffsets(60, 30, 0.002), sinePulse(72));

  const rejectAt = (endS: number) =>
    replay(capture, {
      afterBatch: (live, lastS) => {
        if (lastS >= 12 && lastS < 12.1) live.setSqi(endS, 0.1);
      },
    });

  it.each([
    ['on the 64 Hz grid (640 / 64 s)', 640 * GRID_S],
    ['off the grid on a whole ns (10.3 s)', 10.3],
    ['off the grid, a sum that rounds to a whole ns (0.1 + 0.2 + 10)', 0.1 + 0.2 + 10],
  ])('setSqi with an end %s: live and saved spans agree', (_label, endS) => {
    const session = rejectAt(endS);
    expect(qualitySpans(session.rejectedSpans)).toHaveLength(1);
    expectParity(session);
  });

  // Found by red team. readingInput rounds each setSqi end to whole ns, so an end finer than 1 ns comes
  // back different: 10 + 1/3 s is a span ending at 10.333333333333334 live but 10.333333333 saved. The
  // interface says to pass sqiWindow.endS unchanged, but nothing enforces it. Expected: setSqi refuses
  // such an end with a RangeError, or live and saved agree.
  it.each([
    ['10 + 1/3 s', 10 + 1 / 3],
    ['10 s + 0.4 ns', 10 + 4e-10],
  ])('setSqi with an end finer than 1 ns (%s): refused, or live and saved agree', (_label, endS) => {
    let session: LiveSession;
    try {
      session = rejectAt(endS);
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      return;
    }
    expectParity(session);
  });

  it('readingInput mid-stream, then more frames: each snapshot analyzes to the spans live had then', () => {
    let early: { input: ReturnType<LiveSession['readingInput']>; spans: RejectedSpan[] } | null = null;
    const session = replay(captureAt(regularOffsets(60, 30), flatBetween(12, 20)), {
      score: (endS) => (endS > 22 ? 0.1 : 0.9),
      moving: (tS) => tS >= 14 && tS < 25,
      afterBatch: (live, lastS) => {
        if (early === null && lastS >= 17) early = { input: live.readingInput(), spans: live.rejectedSpans };
      },
    });
    // Frames pushed after the call must not reach the snapshot.
    expect(early!.input.capture.samples.at(-1)!.tNs).toBeLessThan(
      session.readingInput().capture.samples.at(-1)!.tNs,
    );
    const { capture: earlyCapture, ...earlySpans } = early!.input;
    expect(analyzeReading(earlyCapture, contextOf(60, earlySpans)).rejectedSpans).toEqual(early!.spans);
    expectParity(session);
  });
});

describe('red team: analyzeReading stays linear in the capture length', () => {
  // A quadratic flat-window scan would make 4× the capture cost 16× the time; best of two runs each, so
  // a garbage collection in one run does not decide the ratio.
  it('a 360 s capture at 240 fps (flat 40–60 s) costs under 10× a 90 s one', () => {
    const analyzeMs = (seconds: number) => {
      const capture = captureAt(regularOffsets(240, seconds), flatBetween(40, 60));
      const context = contextOf(240, { motionSpans: [], coldHandsSpans: [], sqi: null });
      const timesMs = [0, 1].map(() => {
        const startedMs = performance.now();
        analyzeReading(capture, context);
        return performance.now() - startedMs;
      });
      return Math.min(...timesMs);
    };
    const shortMs = analyzeMs(90);
    const longMs = analyzeMs(360);
    console.info(`analyzeReading at 240 fps: 90 s ${shortMs.toFixed(0)} ms, 360 s ${longMs.toFixed(0)} ms`);
    expect(longMs / shortMs).toBeLessThan(10);
  });
});
