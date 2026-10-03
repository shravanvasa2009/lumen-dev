import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  type CaptureStatus,
  type FrameStat,
  type LiveSession,
  type LiveSessionConfig,
  type ReadingContext,
  type Sample,
} from '../src';
import { captureAt, jitteredOffsets, withPrematureBeats } from './synthetic';

const CLOCK_START_NS = 5_000_000_000_000;
const CONFIG: LiveSessionConfig = { captureFps: 60, sqiThreshold: 0.5, perfusionFloorPct: 0.2 };

interface FrameOptions {
  fps?: number;
  seconds?: number;
  pulseDepth?: number; // −R pulse height on a 0.62 red level
  fingerOff?: (tS: number) => boolean;
  clipped?: (tS: number) => boolean;
  leak?: (tS: number) => boolean; // covered, but R/(G+B) ≈ 2.4
  flat?: (tS: number) => boolean; // red exactly constant
  exposureNs?: (tS: number) => number;
}

interface Frames {
  samples: Sample[];
  stats: FrameStat[];
}

// Gaussian pulses (σ 60 ms) at 72 bpm on a 0.62 red level; G and B low enough that R/(G+B) ≈ 4.
function frames(options: FrameOptions = {}): Frames {
  const { fps = 60, seconds = 30, pulseDepth = 0.004 } = options;
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (let k = 0; k < Math.round(fps * seconds); k++) {
    const tS = k / fps;
    const phase = ((tS - 0.4) * 1.2) % 1;
    const sinceBeat = phase / 1.2;
    const pulse =
      Math.exp(-0.5 * (sinceBeat / 0.06) ** 2) + Math.exp(-0.5 * ((sinceBeat - 1 / 1.2) / 0.06) ** 2);
    const off = options.fingerOff?.(tS) ?? false;
    const leak = options.leak?.(tS) ?? false;
    const tNs = CLOCK_START_NS + Math.round(tS * 1e9);
    samples.push({
      tNs,
      r: off ? 0.25 : options.flat?.(tS) ? 0.62 : 0.62 - pulseDepth * pulse,
      g: off ? 0.22 : leak ? 0.2 : 0.11,
      b: off ? 0.2 : leak ? 0.06 : 0.04,
    });
    stats.push({
      tNs,
      spatialStdR: off ? 0.2 : 0.02,
      clipFrac: options.clipped?.(tS) ? 0.1 : 0,
      exposureNs: options.exposureNs?.(tS) ?? 8_000_000,
    });
  }
  return { samples, stats };
}

const calm: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 60,
  droppedFrac: 0,
};

interface Played {
  session: LiveSession;
  keysAt: { tS: number; key: string | null }[]; // coaching key after each batch, by its last frame
}

// Pushes 100 ms batches, a status every 250 ms of capture time (motion from `moving`), and calls `onBatch`.
function play(
  capture: Frames,
  options: {
    config?: LiveSessionConfig;
    moving?: (tS: number) => boolean;
    onBatch?: (session: LiveSession, tS: number) => void;
  } = {},
): Played {
  const session = createLiveSession(options.config ?? CONFIG);
  const keysAt: Played['keysAt'] = [];
  const toS = (tNs: number) => (tNs - CLOCK_START_NS) / 1e9;
  let nextStatusS = 0;
  for (let start = 0; start < capture.samples.length;) {
    let end = start;
    const batchStartS = toS(capture.samples[start]!.tNs);
    while (end < capture.samples.length && toS(capture.samples[end]!.tNs) < batchStartS + 0.1 - 1e-9) end++;
    session.pushSamples({
      samples: capture.samples.slice(start, end),
      stats: capture.stats.slice(start, end),
    });
    const lastS = toS(capture.samples[end - 1]!.tNs);
    while (nextStatusS <= lastS) {
      session.pushStatus({ ...calm, motionRms: options.moving?.(nextStatusS) ? 0.2 : 0 });
      nextStatusS += 0.25;
    }
    keysAt.push({ tS: lastS, key: session.coachingKey });
    options.onBatch?.(session, lastS);
    start = end;
  }
  return { session, keysAt };
}

const keyAt = (played: Played, tS: number) =>
  played.keysAt.reduce((best, entry) => (Math.abs(entry.tS - tS) < Math.abs(best.tS - tS) ? entry : best))
    .key;
const spansOf = (session: LiveSession, reason: string) =>
  session.rejectedSpans.filter((span) => span.reason === reason);

describe('LiveSession on a clean capture', () => {
  const capture = frames({ seconds: 30 });
  const { session, keysAt } = play(capture);
  const lastS = (capture.samples.at(-1)!.tNs - CLOCK_START_NS) / 1e9;

  it('counts every second as clean and shows no coaching', () => {
    expect(session.rejectedSpans).toEqual([]);
    expect(session.cleanSeconds).toBeCloseTo(lastS, 9);
    expect(keysAt.every((entry) => entry.key === null)).toBe(true);
  });

  it('shows the last 6 s of causal-filtered −R', () => {
    const { tS, ppg } = session.recentWaveform;
    expect(tS).toHaveLength(ppg.length);
    expect(tS.at(-1)).toBeCloseTo(lastS, 9);
    expect(tS[0]!).toBeGreaterThanOrEqual(lastS - DSP_CONFIG.live.waveformS - 1e-9);
    expect(tS[0]!).toBeLessThan(lastS - DSP_CONFIG.live.waveformS + 1 / 60);
    // The morphology band passes the 0.004 pulse at about its height and removes the 0.62 level.
    const range = Math.max(...ppg) - Math.min(...ppg);
    expect(range).toBeGreaterThan(0.002);
    expect(range).toBeLessThan(0.006);
    expect(Math.abs(ppg.reduce((sum, value) => sum + value, 0) / ppg.length)).toBeLessThan(0.001);
  });

  it('offers a 4 s, 64 Hz, z-scored −R window ending within the last second (ADR 0023)', () => {
    const window = session.sqiWindow!;
    expect(window.input).toBeInstanceOf(Float32Array);
    expect(window.input).toHaveLength(256);
    expect(window.endS).toBeGreaterThan(lastS - 1);
    expect(window.endS).toBeLessThanOrEqual(lastS);
    expect(window.endS * 64).toBeCloseTo(Math.round(window.endS * 64), 9);
    const mean = window.input.reduce((sum, value) => sum + value, 0) / 256;
    const sd = Math.sqrt(window.input.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 256);
    expect(mean).toBeCloseTo(0, 5);
    expect(sd).toBeCloseTo(1, 5);
  });

  it('offers the first SQI window at the 4 s check, starting at the first frame (ADR 0057)', () => {
    const ends: number[] = [];
    play(frames({ seconds: 4.5 }), { onBatch: (live) => live.sqiWindow && ends.push(live.sqiWindow.endS) });
    expect(ends[0]).toBe(4);
  });

  it('offers no SQI window before 4 s of covered signal', () => {
    const early: (number | null)[] = [];
    play(frames({ seconds: 6 }), {
      onBatch: (live, tS) => early.push(tS < 3.95 ? (live.sqiWindow?.endS ?? null) : 0),
    });
    expect(early.filter((value) => value !== 0).every((value) => value === null)).toBe(true);
  });
});

describe('LiveSession rejected spans and clean seconds', () => {
  it('DSP-4: an uncovered stretch is a coverage span; clean seconds skip it', () => {
    const { session } = play(frames({ seconds: 30, fingerOff: (tS) => tS >= 10 && tS < 15 }));
    expect(spansOf(session, 'coverage')).toEqual([{ startS: 10, endS: 15, reason: 'coverage' }]);
    expect(session.cleanSeconds).toBeCloseTo(30 - 1 / 60 - 5, 9);
  });

  it('DSP-4: clipping over 5% is a clipping span', () => {
    const { session } = play(frames({ seconds: 30, clipped: (tS) => tS >= 12 && tS < 14 }));
    expect(spansOf(session, 'clipping')).toEqual([{ startS: 12, endS: 14, reason: 'clipping' }]);
  });

  it('DSP-5: an exposure change marks the following 1 s', () => {
    const { session } = play(frames({ seconds: 30, exposureNs: (tS) => (tS < 20 ? 8e6 : 6e6) }));
    expect(spansOf(session, 'exposure')).toEqual([{ startS: 20, endS: 21, reason: 'exposure' }]);
  });

  it('motion: a status above the threshold opens a span until a calm status', () => {
    expect(DSP_CONFIG.live.motionRmsThreshold).toBe(0.05);
    const { session } = play(frames({ seconds: 30 }), { moving: (tS) => tS >= 20 && tS < 23 });
    const [span] = spansOf(session, 'motion');
    expect(spansOf(session, 'motion')).toHaveLength(1);
    // Statuses carry no time: each is placed at the newest frame, so edges land within one batch.
    expect(Math.abs(span!.startS - 20)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(span!.endS - 23)).toBeLessThanOrEqual(0.1);
  });

  it('never shows clean seconds going down: after a late SQI rejection the count pauses, then catches up', () => {
    // True clean seconds, from the spans: what analyzeReading and the result use.
    const trueClean = (live: LiveSession) => {
      const { tS } = live.recentWaveform;
      return cleanSeconds(0, tS.at(-1)!, live.rejectedSpans);
    };
    const shown: { tS: number; exposed: number; truth: number }[] = [];
    let rejected = false;
    play(frames({ seconds: 30 }), {
      onBatch: (live, tS) => {
        if (!rejected && tS >= 20) {
          const before = live.cleanSeconds;
          live.setSqi(20, 0.1); // rejects 16–20 s, after those seconds were already counted
          expect(trueClean(live)).toBeCloseTo(before - 4, 9);
          expect(live.cleanSeconds).toBe(before);
          rejected = true;
        }
        shown.push({ tS, exposed: live.cleanSeconds, truth: trueClean(live) });
      },
    });
    shown.slice(1).forEach((entry, i) => expect(entry.exposed).toBeGreaterThanOrEqual(shown[i]!.exposed));
    // Never below the true value either.
    shown.forEach((entry) => expect(entry.exposed).toBeGreaterThanOrEqual(entry.truth));
    const at = (tS: number) =>
      shown.reduce((best, entry) => (Math.abs(entry.tS - tS) < Math.abs(best.tS - tS) ? entry : best));
    // Paused from 20 s until the true count reaches it again, about 4 s later.
    expect(at(22).exposed).toBe(at(20.1).exposed);
    expect(at(28).exposed).toBeCloseTo(at(28).truth, 9);
    expect(shown.at(-1)!.exposed).toBeCloseTo(30 - 1 / 60 - 4, 9);
  });

  it('SQI: a score under the threshold rejects its 4 s window; none before the first score', () => {
    const pending = [12, 13];
    const { session } = play(frames({ seconds: 30 }), {
      onBatch: (live, tS) => {
        // Each score arrives once its window has ended: setSqi refuses an end after the newest frame.
        if (pending.length === 0 || tS < pending[0]!) return;
        if (pending[0] === 12) expect(spansOf(live, 'quality')).toEqual([]);
        const endS = pending.shift()!;
        live.setSqi(endS, endS === 12 ? 0.2 : 0.9);
      },
    });
    expect(spansOf(session, 'quality')).toEqual([{ startS: 8, endS: 12, reason: 'quality' }]);
  });

  it('a flat window never reaches the model and counts as rejected (ADR 0023)', () => {
    const windows: (number | null)[] = [];
    const { session } = play(frames({ seconds: 40, flat: (tS) => tS >= 10 && tS < 20 }), {
      onBatch: (live, tS) => {
        if (Math.abs(tS - 17) < 0.05 || Math.abs(tS - 30) < 0.05) windows.push(live.sqiWindow?.endS ?? null);
      },
    });
    expect(windows[0]).toBeNull();
    expect(windows[1]).not.toBeNull();
    const quality = spansOf(session, 'quality');
    expect(quality.length).toBeGreaterThan(0);
    expect(Math.min(...quality.map((span) => span.startS))).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(Math.max(...quality.map((span) => span.endS))).toBeLessThanOrEqual(24 + 1e-9);
  });

  it('cold hands: a perfusion index under the floor after 10 s pauses the reading', () => {
    const { session } = play(frames({ seconds: 30, pulseDepth: 0.0002 }));
    const [span] = spansOf(session, 'coldHands');
    expect(span!.startS).toBeGreaterThanOrEqual(DSP_CONFIG.live.coldHandsAfterS);
    expect(span!.startS).toBeLessThan(DSP_CONFIG.live.coldHandsAfterS + 1.01);
    expect(spansOf(play(frames({ seconds: 30 })).session, 'coldHands')).toEqual([]);
  });
});

describe('LiveSession coaching (one key at a time, with hysteresis)', () => {
  const { coachEnterS, coachMinShowS, coachExitS } = DSP_CONFIG.live;

  it('uses dwell times of 0.5 s to show, 2 s minimum on screen, and 1 s to clear', () => {
    expect([coachEnterS, coachMinShowS, coachExitS]).toEqual([0.5, 2, 1]);
  });

  it('asks to cover the lens after 0.5 s uncovered and clears 1 s after contact returns', () => {
    const played = play(frames({ seconds: 30, fingerOff: (tS) => tS >= 10 && tS < 15 }));
    expect(keyAt(played, 10.3)).toBeNull();
    expect(keyAt(played, 10.6)).toBe('coach.cover');
    expect(keyAt(played, 15.6)).toBe('coach.cover');
    expect(keyAt(played, 16.2)).toBeNull();
  });

  it('ignores a 0.3 s blip, and keeps a shown key for at least 2 s', () => {
    expect(
      play(frames({ seconds: 30, fingerOff: (tS) => tS >= 10 && tS < 10.3 })).keysAt.every(
        (entry) => entry.key === null,
      ),
    ).toBe(true);
    const played = play(frames({ seconds: 30, fingerOff: (tS) => tS >= 10 && tS < 10.8 }));
    expect(keyAt(played, 12.3)).toBe('coach.cover');
    expect(keyAt(played, 12.7)).toBeNull();
  });

  it('maps each §7 check to its key', () => {
    expect(keyAt(play(frames({ seconds: 30, clipped: (tS) => tS >= 10 })), 12)).toBe('coach.lighter');
    expect(keyAt(play(frames({ seconds: 30, leak: (tS) => tS >= 10 })), 12)).toBe('coach.flat');
    expect(keyAt(play(frames({ seconds: 30 }), { moving: (tS) => tS >= 10 }), 12)).toBe('coach.still');
    expect(keyAt(play(frames({ seconds: 30, pulseDepth: 0.0002 })), 14)).toBe('coach.warm');
  });

  it('a light leak is coached but not rejected', () => {
    expect(play(frames({ seconds: 30, leak: (tS) => tS >= 10 })).session.rejectedSpans).toEqual([]);
  });

  it('shows the highest-priority key: cover over hold still', () => {
    const played = play(frames({ seconds: 30, fingerOff: (tS) => tS >= 10 && tS < 20 }), {
      moving: (tS) => tS >= 8,
    });
    expect(keyAt(played, 9)).toBe('coach.still');
    expect(keyAt(played, 12)).toBe('coach.cover');
  });
});

describe('LiveSession input checks and buffer size', () => {
  it('refuses timestamps that do not increase and stats that do not match the samples', () => {
    const { samples, stats } = frames({ seconds: 1 });
    const session = createLiveSession(CONFIG);
    session.pushSamples({ samples: samples.slice(0, 5), stats: stats.slice(0, 5) });
    expect(() => session.pushSamples({ samples: samples.slice(4, 6), stats: stats.slice(4, 6) })).toThrow(
      RangeError,
    );
    expect(() => session.pushSamples({ samples: samples.slice(5, 7), stats: stats.slice(6, 8) })).toThrow(
      RangeError,
    );
  });

  it('refuses an SQI window end finer than 1 ns, which readingInput could not hand on exactly', () => {
    const { session } = play(frames({ seconds: 12 }));
    expect(() => session.setSqi(10 + 1 / 3, 0.1)).toThrow(RangeError);
    expect(session.readingInput().sqi).toBeNull();
    session.setSqi(10.3, 0.1);
    expect(spansOf(session, 'quality')).toEqual([{ startS: 10.3 - 4, endS: 10.3, reason: 'quality' }]);
  });

  it('takes a frame with non-finite red as uncovered and keeps the waveform finite', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const capture = frames({ seconds: 20 });
      capture.samples[600]!.r = bad;
      const { session } = play(capture);
      expect(spansOf(session, 'coverage')).toEqual([
        { startS: 10, endS: (capture.samples[601]!.tNs - CLOCK_START_NS) / 1e9, reason: 'coverage' },
      ]);
      expect(session.recentWaveform.ppg.every(Number.isFinite)).toBe(true);
      expect(session.sqiWindow).not.toBeNull();
    }
  });

  it('refuses an SQI window end outside the reading, and a P(clean) outside [0, 1]', () => {
    const { session } = play(frames({ seconds: 12 }));
    for (const endS of [NaN, Infinity, -Infinity, -1, 9_002_345.606197001])
      expect(() => session.setSqi(endS, 0.1)).toThrow(RangeError);
    for (const pClean of [NaN, -0.1, 1.1, Infinity])
      expect(() => session.setSqi(8, pClean)).toThrow(RangeError);
    expect(() => createLiveSession(CONFIG).setSqi(0, 0.1)).toThrow(RangeError);
    expect(session.readingInput().sqi).toBeNull();
  });

  it('refuses a capture rate whose Nyquist frequency is not above the 8 Hz morphology band edge', () => {
    expect(() => createLiveSession({ ...CONFIG, captureFps: 16 })).toThrow(RangeError);
    expect(() => createLiveSession({ ...CONFIG, captureFps: 24 })).not.toThrow();
  });

  it('holds the longest reading (6 min) at its frame rate with 25% margin, and refuses more', () => {
    expect(DSP_CONFIG.live.maxReadingS).toBe(360);
    const config = { ...CONFIG, captureFps: 20 };
    const capacity = Math.ceil(360 * 20 * 1.25);
    const { samples, stats } = frames({ fps: 20, seconds: capacity / 20 + 1 });
    const session = createLiveSession(config);
    session.pushSamples({ samples: samples.slice(0, capacity), stats: stats.slice(0, capacity) });
    expect(() =>
      session.pushSamples({
        samples: samples.slice(capacity, capacity + 1),
        stats: stats.slice(capacity, capacity + 1),
      }),
    ).toThrow(RangeError);
  });
});

describe('live and replay paths agree', () => {
  // Coverage gap, exposure change, motion, and a low SQI score, all in one 60 s capture.
  const capture = frames({
    seconds: 60,
    fingerOff: (tS) => tS >= 20 && tS < 23,
    exposureNs: (tS) => (tS < 35 ? 8e6 : 6e6),
  });
  let scored = false;
  const { session } = play(capture, {
    moving: (tS) => tS >= 40 && tS < 42,
    onBatch: (live, tS) => {
      if (!scored && tS >= 50) {
        live.setSqi(50, 0.1);
        scored = true;
      }
    },
  });
  const toNs = (tS: number) => CLOCK_START_NS + Math.round(tS * 1e9);
  const spansNs = (reason: string) =>
    spansOf(session, reason).map((span) => ({ startNs: toNs(span.startS), endNs: toNs(span.endS) }));
  const context: ReadingContext = {
    captureFps: 60,
    tier: 'full',
    mode: 'full',
    restTimerDone: true,
    recordedAt: null,
    motionSpans: spansNs('motion'),
    coldHandsSpans: spansNs('coldHands'),
    sqi: { threshold: CONFIG.sqiThreshold, windows: [{ endNs: toNs(50), pClean: 0.1 }] },
    validationRhythmLabel: null,
  };

  it('the session spans and clean seconds equal analyzeReading on the same samples', () => {
    const analysis = analyzeReading(capture, context);
    expect(analysis.rejectedSpans).toHaveLength(session.rejectedSpans.length);
    analysis.rejectedSpans.forEach((span, i) => {
      const live = session.rejectedSpans[i]!;
      expect(span.reason).toBe(live.reason);
      expect(span.startS).toBeCloseTo(live.startS, 9);
      expect(span.endS).toBeCloseTo(live.endS, 9);
    });
    // The true count (from the spans), which the displayed count equals once it has caught up.
    const lastS = (capture.samples.at(-1)!.tNs - CLOCK_START_NS) / 1e9;
    const trueClean = cleanSeconds(0, lastS, session.rejectedSpans);
    expect(analysis.cleanSeconds).toBeCloseTo(trueClean, 9);
    expect(session.cleanSeconds).toBeCloseTo(trueClean, 9);
  });

  it('a capture read back from Appendix B CSV text gives the identical analysis', () => {
    const csvRows = capture.samples.map((sample, i) => {
      const stat = capture.stats[i]!;
      return [
        `${sample.tNs},${sample.r},${sample.g},${sample.b}`,
        `${stat.tNs},${stat.spatialStdR},${stat.clipFrac},${stat.exposureNs}`,
      ];
    });
    const samples = csvRows.map(([row]) => {
      const [tNs, r, g, b] = row!.split(',').map(Number);
      return { tNs: tNs!, r: r!, g: g!, b: b! };
    });
    const stats = csvRows.map(([, row]) => {
      const [tNs, spatialStdR, clipFrac, exposureNs] = row!.split(',').map(Number);
      return { tNs: tNs!, spatialStdR: spatialStdR!, clipFrac: clipFrac!, exposureNs: exposureNs! };
    });
    expect(analyzeReading({ samples, stats }, context)).toEqual(analyzeReading(capture, context));
  });
});

describe('readingInput hands analyzeReading what the session saw (H-025)', () => {
  const toNs = (tS: number) => CLOCK_START_NS + Math.round(tS * 1e9);
  const spansNs = (session: LiveSession, reason: string) =>
    spansOf(session, reason).map((span) => ({ startNs: toNs(span.startS), endNs: toNs(span.endS) }));
  const contextWith = (
    spans: Pick<ReadingContext, 'motionSpans' | 'coldHandsSpans' | 'sqi'>,
  ): ReadingContext => ({
    captureFps: 60,
    tier: 'full',
    mode: 'full',
    restTimerDone: true,
    recordedAt: null,
    validationRhythmLabel: null,
    ...spans,
  });
  const analyzeInput = (session: LiveSession) => {
    const { capture, ...spans } = session.readingInput();
    return analyzeReading(capture, contextWith(spans));
  };

  // Jittered 60 fps frames of a two-Gaussian pulse at 75 bpm with premature beats, on a 0.62 red level.
  const beats = withPrematureBeats(0.8, 60, [10, 30, 50], 0.6);
  const capture = captureAt(jitteredOffsets(60, 60, 0.002), (tS) => {
    const pulse = beats.reduce(
      (sum, { peakS, amplitude }) =>
        sum +
        amplitude *
          (Math.exp(-0.5 * ((tS - peakS) / 0.06) ** 2) +
            0.3 * Math.exp(-0.5 * ((tS - peakS - 0.3) / 0.08) ** 2)),
      0,
    );
    return { r: 0.62 - 0.004 * pulse, g: 0.11, b: 0.04 };
  });
  const scores = [
    { endS: 30, pClean: 0.9 },
    { endS: 50, pClean: 0.1 },
  ];
  const pending = [...scores];
  const { session } = play(capture, {
    moving: (tS) => tS >= 40 && tS < 42,
    onBatch: (live, tS) => {
      while (pending.length > 0 && tS >= pending[0]!.endS) {
        const { endS, pClean } = pending.shift()!;
        live.setSqi(endS, pClean);
      }
    },
  });

  it('returns the frames, motion spans, and SQI scores the app would otherwise assemble itself', () => {
    const input = session.readingInput();
    expect(input.capture).toEqual(capture);
    expect(input.motionSpans).toHaveLength(1);
    expect(input.motionSpans).toEqual(spansNs(session, 'motion'));
    expect(input.coldHandsSpans).toEqual([]);
    expect(input.sqi).toEqual({
      threshold: CONFIG.sqiThreshold,
      windows: scores.map(({ endS, pClean }) => ({ endNs: toNs(endS), pClean })),
    });
  });

  it('analyzeReading on it deep-equals analyzeReading on the directly assembled reading', () => {
    const direct = contextWith({
      motionSpans: spansNs(session, 'motion'),
      coldHandsSpans: [],
      sqi: {
        threshold: CONFIG.sqiThreshold,
        windows: scores.map(({ endS, pClean }) => ({ endNs: toNs(endS), pClean })),
      },
    });
    const fromSession = analyzeInput(session);
    expect(fromSession).toEqual(analyzeReading(capture, direct));
    expect(fromSession.rejectedSpans).toEqual(session.rejectedSpans);
    expect(fromSession.sqiAvailable).toBe(true);
  });

  it('carries cold-hands spans, and sqi is null when setSqi was never called', () => {
    const cold = frames({ seconds: 30, pulseDepth: 0.0002 });
    const { session: coldSession } = play(cold);
    const input = coldSession.readingInput();
    expect(input.sqi).toBeNull();
    expect(input.coldHandsSpans.length).toBeGreaterThan(0);
    expect(input.coldHandsSpans).toEqual(spansNs(coldSession, 'coldHands'));
    const direct = contextWith({
      motionSpans: [],
      coldHandsSpans: spansNs(coldSession, 'coldHands'),
      sqi: null,
    });
    const fromSession = analyzeInput(coldSession);
    expect(fromSession).toEqual(analyzeReading(cold, direct));
    expect(fromSession.rejectedSpans).toEqual(coldSession.rejectedSpans);
    expect(fromSession.sqiAvailable).toBe(false);
  });

  it('closes a span still open at the end at the newest frame, as rejectedSpans does', () => {
    const open = frames({ seconds: 20 });
    const { session: moving } = play(open, { moving: (tS) => tS >= 15 });
    const [span] = moving.readingInput().motionSpans;
    expect(span!.endNs).toBe(open.samples.at(-1)!.tNs);
    expect(moving.readingInput().motionSpans).toEqual(spansNs(moving, 'motion'));
  });

  it('without SQI-Net, the saved result rejects the same flat windows as the live screen (ADR 0023)', () => {
    const flat = frames({ seconds: 40, flat: (tS) => tS >= 10 && tS < 20 });
    const { session: flatSession } = play(flat);
    const input = flatSession.readingInput();
    expect(input.sqi).toBeNull();
    const fromSession = analyzeInput(flatSession);
    expect(spansOf(flatSession, 'quality').length).toBeGreaterThan(0);
    expect(fromSession.rejectedSpans).toEqual(flatSession.rejectedSpans);
    expect(fromSession.cleanSeconds).toBe(flatSession.cleanSeconds);
    expect(fromSession.sqiAvailable).toBe(false);
  });

  it('sqi.windows holds only model scores; flat windows come from the frames, counted once', () => {
    const flat = frames({ seconds: 40, flat: (tS) => tS >= 10 && tS < 20 });
    let scored = false;
    const { session: flatSession } = play(flat, {
      onBatch: (live, tS) => {
        if (!scored && tS >= 30) {
          live.setSqi(30, 0.9);
          scored = true;
        }
      },
    });
    expect(flatSession.readingInput().sqi).toEqual({
      threshold: CONFIG.sqiThreshold,
      windows: [{ endNs: toNs(30), pClean: 0.9 }],
    });
    const fromSession = analyzeInput(flatSession);
    expect(fromSession.rejectedSpans).toEqual(flatSession.rejectedSpans);
    expect(fromSession.cleanSeconds).toBe(flatSession.cleanSeconds);
  });

  describe('motion, cold hands, a low SQI score, and flat frames in one capture', () => {
    // A 0.0002 pulse is under the 0.2% perfusion floor, so cold hands opens at the 10 s check and stays.
    const mixed = frames({ seconds: 45, pulseDepth: 0.0002, flat: (tS) => tS >= 30 && tS < 37 });
    let scored = false;
    const { session: mixedSession } = play(mixed, {
      moving: (tS) => tS >= 20 && tS < 23,
      onBatch: (live, tS) => {
        if (!scored && tS >= 25) {
          live.setSqi(25, 0.1);
          scored = true;
        }
      },
    });
    const frameNs = (k: number) => mixed.samples[k]!.tNs;

    it('the saved spans and clean seconds equal the live ones', () => {
      const fromSession = analyzeInput(mixedSession);
      const reasons = new Set(fromSession.rejectedSpans.map((span) => span.reason));
      expect([...reasons].sort()).toEqual(['coldHands', 'motion', 'quality']);
      expect(fromSession.rejectedSpans).toEqual(mixedSession.rejectedSpans);
      expect(fromSession.cleanSeconds).toBe(mixedSession.cleanSeconds);
    });

    it('puts span edges on frame times', () => {
      const input = mixedSession.readingInput();
      // Statuses land after each 100 ms batch: the 20 s one after the batch of frames 1200–1205, the calm
      // 23 s one after frames 1380–1385. The cold-hands check runs at the first frame at or after 10 s.
      expect(input.motionSpans).toEqual([{ startNs: frameNs(1205), endNs: frameNs(1385) }]);
      expect(input.coldHandsSpans[0]!.startNs).toBe(frameNs(600));
      expect(input.coldHandsSpans.at(-1)!.endNs).toBe(frameNs(mixed.samples.length - 1));
      expect(input.sqi).toEqual({
        threshold: CONFIG.sqiThreshold,
        windows: [{ endNs: toNs(25), pClean: 0.1 }],
      });
      const quality = analyzeInput(mixedSession).rejectedSpans.filter((span) => span.reason === 'quality');
      expect(quality[0]).toEqual({ startS: 21, endS: 25, reason: 'quality' });
      // The flat windows lie wholly inside frames 1800–2219 (30 s to 36.98 s).
      expect(quality.length).toBeGreaterThan(1);
      for (const span of quality.slice(1)) {
        expect(span.startS).toBeGreaterThanOrEqual(30);
        expect(span.endS).toBeLessThanOrEqual(2219 / 60);
      }
    });
  });

  it('gives equal results when called twice, and callers cannot change the session through them', () => {
    const first = session.readingInput();
    first.capture.samples[0]!.r = 0;
    first.capture.samples.pop();
    first.capture.stats.length = 0;
    first.motionSpans.push({ startNs: 0, endNs: 1 });
    first.sqi!.windows[0]!.pClean = 0;
    first.sqi!.windows.length = 0;
    const second = session.readingInput();
    expect(second.capture).toEqual(capture);
    expect(second).toEqual(session.readingInput());
    expect(second.sqi!.windows).toHaveLength(scores.length);
    expect(second.sqi!.windows[0]!.pClean).toBe(0.9);
    expect(second.motionSpans).toEqual(spansNs(session, 'motion'));
  });

  it('keeps accumulating after it is called mid-reading', () => {
    const queued = [...scores];
    let early: ReturnType<LiveSession['readingInput']> | null = null;
    const { session: late } = play(capture, {
      moving: (tS) => tS >= 40 && tS < 42,
      onBatch: (live, tS) => {
        while (queued.length > 0 && tS >= queued[0]!.endS) {
          const { endS, pClean } = queued.shift()!;
          live.setSqi(endS, pClean);
        }
        if (early === null && tS >= 35) early = live.readingInput();
      },
    });
    expect(early!.capture.samples.length).toBeLessThan(capture.samples.length);
    expect(early!.sqi!.windows).toHaveLength(1);
    expect(late.readingInput()).toEqual(session.readingInput());
    expect(analyzeInput(late)).toEqual(analyzeInput(session));
  });
});

describe('LiveSession performance (§9.3: < 5 ms of JS per 100 ms batch)', () => {
  // A regression guard on this PC, not a phone measurement.
  it.each([60, 240])('processes a 100 ms batch at %i fps in < 5 ms median, 60 s into a reading', (fps) => {
    const capture = frames({ fps, seconds: 70 });
    const session = createLiveSession({ ...CONFIG, captureFps: fps });
    const perBatch = fps / 10;
    const warm = 60 * fps;
    session.pushSamples({ samples: capture.samples.slice(0, warm), stats: capture.stats.slice(0, warm) });
    const times: number[] = [];
    for (let start = warm; start + perBatch <= capture.samples.length; start += perBatch) {
      const begun = performance.now();
      session.pushSamples({
        samples: capture.samples.slice(start, start + perBatch),
        stats: capture.stats.slice(start, start + perBatch),
      });
      void session.cleanSeconds;
      void session.coachingKey;
      times.push(performance.now() - begun);
    }
    times.sort((x, y) => x - y);
    expect(times[times.length >> 1]!).toBeLessThan(5);
  });
});
