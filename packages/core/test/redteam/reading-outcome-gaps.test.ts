import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  readingOutcome,
  type CaptureStatus,
  type InconclusiveOutcome,
  type LiveSession,
  type ReadingAnalysis,
  type ReadingContext,
  type ReadingOutcome,
} from '../../src';
import { captureAt, regularOffsets, type SyntheticCapture } from '../synthetic';
import type { Channels } from './attacks';

// Red team for cf3a4cc (ADR 0072 addendum): a DSP-2 frame gap (> dsp2.maxGapS, with resample's half-ns
// allowance) is a quality span in analyzeReading and LiveSession, so time with no frames is not clean.
// The invariants: a gap is lost exactly when DSP-2 splits there; each lost second is counted once; the
// live count and the saved analysis agree; and no flat or frameless stretch counts as clean.

const CONTEXT: ReadingContext = {
  captureFps: 30,
  tier: 'basic',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};

const SQI_THRESHOLD = 0.5;
const MAX_GAP_NS = DSP_CONFIG.dsp2.maxGapS * 1e9;

// 75 bpm with a dicrotic wave at 0.3 of the systolic one, on a covered fingertip.
const RR_S = 0.8;
const gaussian = (x: number, centre: number, width: number) => Math.exp(-0.5 * ((x - centre) / width) ** 2);
const pulse: Channels = (tS) => {
  const phaseS = (((tS + 2) % RR_S) + RR_S) % RR_S;
  const volume = gaussian(phaseS, 0.12, 0.07) + 0.3 * gaussian(phaseS, 0.4, 0.07);
  return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
};
const flat: Channels = () => ({ r: 0.6, g: 0.1, b: 0.05 });
const emptyRoom: Channels = () => ({ r: 0.08, g: 0.08, b: 0.07 });

// Frame offsets in whole ns, so a gap is exactly the ns the test names.
const fromNs = (offsetsNs: number[]) => offsetsNs.map((offsetNs) => offsetNs / 1e9);
const framesNs = (fromNsAt: number, count: number, stepNs: number) =>
  Array.from({ length: count }, (_, k) => fromNsAt + k * stepNs);
const FRAME_NS = 1e9 / 30;
// 30 fps frames from fromS up to and including toS, on whole ns.
const run30 = (fromS: number, toS: number) =>
  framesNs(fromS * 1e9, Math.floor(((toS - fromS) * 1e9) / FRAME_NS + 1e-6) + 1, FRAME_NS).map(Math.round);

function inconclusive(outcome: ReadingOutcome): InconclusiveOutcome {
  if (outcome.kind !== 'inconclusive') throw new Error('expected an inconclusive outcome');
  return outcome;
}

// ADR 0104: a capture with a heart rate is a reading; without one, its lost time is attributed.
const withoutRate = (analysis: ReadingAnalysis): ReadingAnalysis => ({
  ...analysis,
  heartRateBpm: null,
  lowQuality: { ...analysis.lowQuality, heartRateBpm: null },
});

function expectAddsUp(analysis: ReadingAnalysis, outcome: InconclusiveOutcome): void {
  const { motion, pressure, coverage, coldHands } = outcome.lostSeconds;
  const total = outcome.cleanSeconds + motion + pressure + coverage + coldHands + outcome.otherLostSeconds;
  expect(total).toBeCloseTo(analysis.durationS, 9);
}

// The intervals DSP-2 does not interpolate across, in seconds.
function frameGapsS(analysis: ReadingAnalysis, capture: SyntheticCapture): number {
  const startNs = capture.samples[0]!.tNs;
  const tS = capture.samples.map((sample) => (sample.tNs - startNs) / 1e9);
  return tS
    .slice(1)
    .map((to, i) => to - tS[i]!)
    .filter((intervalS) => intervalS > DSP_CONFIG.dsp2.maxGapS + 0.5e-9)
    .reduce((sum, intervalS) => sum + intervalS, 0);
}

const still: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 30,
  droppedFrac: 0,
};

interface ReplayOptions {
  score?: (endS: number) => number | null; // null: not scored yet
  // Called after each batch with the live count, as the capture screen reads it.
  onBatch?: (session: LiveSession, lastS: number) => void;
}

// 100 ms batches and a 4 Hz status, as the capture module sends them (as in reading-input-hardening).
function replay(capture: SyntheticCapture, options: ReplayOptions = {}): LiveSession {
  const session = createLiveSession({
    captureFps: 30,
    sqiThreshold: SQI_THRESHOLD,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  const secondsOf = (index: number) => (capture.samples[index]!.tNs - capture.samples[0]!.tNs) / 1e9;
  let nextStatusS = 0;
  let scoredEndS: number | null = null;
  for (let start = 0; start < capture.samples.length;) {
    let end = start + 1;
    while (end < capture.samples.length && secondsOf(end) < secondsOf(start) + 0.1) end++;
    session.pushSamples({
      samples: capture.samples.slice(start, end),
      stats: capture.stats.slice(start, end),
    });
    const lastS = secondsOf(end - 1);
    while (nextStatusS <= lastS) {
      session.pushStatus(still);
      nextStatusS += 0.25;
    }
    const window = session.sqiWindow;
    const pClean = options.score && window && window.endS !== scoredEndS ? options.score(window.endS) : null;
    if (window && pClean !== null) {
      scoredEndS = window.endS;
      session.setSqi(window.endS, pClean);
    }
    options.onBatch?.(session, lastS);
    start = end;
  }
  return session;
}

function savedFrom(session: LiveSession, mode = 'full'): ReadingAnalysis {
  const { capture, ...spans } = session.readingInput();
  return analyzeReading(capture, { ...CONTEXT, mode, ...spans });
}

describe('red team: a frame gap at dsp2.maxGapS ± 1 ns', () => {
  it.each([
    [MAX_GAP_NS - 1, false],
    [MAX_GAP_NS, false],
    [MAX_GAP_NS + 1, true],
    [151e6, true],
  ])(
    'one %i ns interval at 20 s in 40 s of pulse: lost %p, exactly when DSP-2 splits there',
    (gapNs, lost) => {
      const before = run30(0, 20);
      const resumeNs = before[before.length - 1]! + gapNs;
      const capture = captureAt(
        fromNs([...before, ...framesNs(resumeNs, 600, FRAME_NS).map(Math.round)]),
        pulse,
      );
      const analysis = analyzeReading(capture, CONTEXT);
      expect(analysis.segments).toHaveLength(lost ? 2 : 1);
      expect(analysis.durationS - analysis.cleanSeconds).toBeCloseTo(lost ? gapNs / 1e9 : 0, 9);
    },
  );

  it('frames every 151 ms for 100 s: no second is clean, and no coaching cause is named', () => {
    const capture = captureAt(fromNs(framesNs(0, 663, 151e6)), pulse);
    const analysis = analyzeReading(capture, CONTEXT);
    const outcome = inconclusive(readingOutcome(analysis));
    expect(outcome.cleanSeconds).toBe(0);
    expect(outcome.otherLostSeconds).toBeCloseTo(analysis.durationS, 9);
    expect(outcome.causes).toEqual([]);
  });

  it.each([
    [3, 0], // 133 ms: a DSP-1 dropped frame, splined over, still clean
    [4, 1], // 167 ms: a DSP-2 gap
  ])(
    'dropping %i frames after each whole second of a 100 s Full Scan loses each gap once',
    (dropped, gapsLost) => {
      const offsets = regularOffsets(30, 100).filter((tS) => {
        const k = Math.round(tS * 30) % 30;
        return tS < 1 || k === 0 || k > dropped;
      });
      const capture = captureAt(offsets, pulse);
      const analysis = analyzeReading(capture, CONTEXT);
      expect(analysis.durationS - analysis.cleanSeconds).toBeCloseTo(frameGapsS(analysis, capture), 9);
      expect(readingOutcome(analysis).kind).toBe(gapsLost ? 'inconclusive' : 'reading');
    },
  );

  it('a lone first frame 5 s before the rest: the gap is lost, and 30 s of frames after it is a Quick reading', () => {
    const capture = captureAt([0, ...regularOffsets(30, 30.04).map((tS) => tS + 5)], pulse);
    const analysis = analyzeReading(capture, { ...CONTEXT, mode: 'quick' });
    expect(analysis.cleanSeconds).toBeCloseTo(30, 6);
    expect(analysis.rejectedSpans[0]).toEqual({ startS: 0, endS: 5, reason: 'quality' });
    expect(readingOutcome(analysis).kind).toBe(analysis.cleanSeconds >= 30 ? 'reading' : 'inconclusive');
  });

  it('a lone last frame 5 s after the rest: the gap is lost, and the capture is short of Quick', () => {
    const capture = captureAt([...regularOffsets(30, 30), 34.9666666667], pulse);
    const analysis = analyzeReading(capture, { ...CONTEXT, mode: 'quick' });
    expect(readingOutcome(analysis).kind).toBe('reading');
    const outcome = inconclusive(readingOutcome(withoutRate(analysis)));
    expect(outcome.cleanSeconds).toBeCloseTo(29.9666666667, 6);
    expect(outcome.otherLostSeconds).toBeCloseTo(5, 6);
  });

  it('a gap inside a motion span and a gap after the finger lifts: each second counted once, under its cause', () => {
    // Frames to 20 s, none to 30 s, then on to 50 s; the finger is off from 40 s, and the frames stop again
    // from 45 s to 48 s. Motion from 15 s to 35 s covers the first gap.
    const offsets = [...run30(0, 20), ...run30(30, 45), ...run30(48, 50)].map((offsetNs) => offsetNs / 1e9);
    const capture = captureAt(offsets, (tS) => (tS >= 40 ? emptyRoom(tS) : pulse(tS)));
    const startNs = capture.samples[0]!.tNs;
    const analysis = analyzeReading(capture, {
      ...CONTEXT,
      motionSpans: [{ startNs: startNs + 15e9, endNs: startNs + 35e9 }],
    });
    expect(readingOutcome(analysis).kind).toBe('reading');
    const outcome = inconclusive(readingOutcome(withoutRate(analysis)));
    expectAddsUp(analysis, outcome);
    expect(outcome.lostSeconds.motion).toBeCloseTo(20, 6);
    expect(outcome.lostSeconds.coverage).toBeCloseTo(10, 6); // 40–50 s, the 45–48 s gap included
    expect(outcome.otherLostSeconds).toBe(0);
    expect(outcome.cleanSeconds).toBeCloseTo(20, 6); // 0–15 s and 35–40 s
  });
});

describe('red team: live count and saved analysis with frame gaps (100 ms batches)', () => {
  const scenarios: [string, () => number[]][] = [
    [
      'one 151 ms gap',
      () => fromNs([...run30(0, 20), ...framesNs(20e9 + 151e6, 300, FRAME_NS).map(Math.round)]),
    ],
    [
      'a 151 ms gap after every whole second',
      () => regularOffsets(30, 40).filter((tS) => tS < 1 || ![1, 2, 3, 4].includes(Math.round(tS * 30) % 30)),
    ],
    ['a lone first frame, then 5 s of nothing', () => [0, ...regularOffsets(30, 20).map((tS) => tS + 5)]],
    ['frames every 151 ms', () => fromNs(framesNs(0, 200, 151e6))],
    ['the camera backgrounded from 50 s to 110 s', () => fromNs([...run30(0, 50), ...run30(110, 150)])],
  ];

  it.each(scenarios)(
    '%s: same spans and clean seconds, and the ring never ran ahead of the saved count',
    (_, offsets) => {
      const capture = captureAt(offsets(), pulse);
      let shownMaxS = 0;
      const session = replay(capture, {
        score: () => 0.9,
        onBatch: (live) => (shownMaxS = Math.max(shownMaxS, live.cleanSeconds)),
      });
      const saved = savedFrom(session);
      expect(saved.rejectedSpans).toEqual(session.rejectedSpans);
      expect(saved.cleanSeconds).toBe(session.cleanSeconds);
      expect(shownMaxS).toBe(saved.cleanSeconds);
    },
  );

  // After the gap SQI-Net has no 4 s window until 4 s of frames exist, so those 4 s are unscored and
  // lost (ADR 0057), live and saved alike.
  it('a camera that resumes after 60 s finishes a Full Scan only on the frames it has, less 4 s unscored', () => {
    const capture = captureAt(fromNs([...run30(0, 50), ...run30(110, 154.1)]), pulse);
    const saved = savedFrom(replay(capture, { score: () => 0.9 }));
    expect(saved.cleanSeconds).toBeCloseTo(90.1, 6);
    expect(readingOutcome(saved)).toEqual({ kind: 'reading', urgent: null });
    const shortCapture = captureAt(fromNs([...run30(0, 50), ...run30(110, 153.9)]), pulse);
    const short = savedFrom(replay(shortCapture, { score: () => 0.9 }));
    expect(short.cleanSeconds).toBeLessThan(90);
    // ADR 0104: short of the target it is still a reading, tagged lower quality on its results.
    expect(readingOutcome(short)).toEqual({ kind: 'reading', urgent: null });
  });
});

describe('red team: flat runs at exactly dsp2.maxGapS (model-window FlatRuns)', () => {
  // FAILS on cf3a4cc. FlatRuns continues a run while tS − lastS ≤ dsp2.maxGapS, without resample's half-ns
  // allowance. Frames exactly 150 000 000 ns apart are not a DSP-2 gap (isFrameGap), but 316 of 699 such
  // intervals compute as 0.15000000000000002 s and end the run, and no span covers the interval between
  // the runs. Observed: 100 s of constant covered red at 150 ms (667 frames) has 44.55 clean seconds.
  // Expected: 0 (ADR 0057: constant red holds no pulse, rejected at any length).
  it('constant red at exactly 150 ms per frame is rejected from first to last frame', () => {
    const analysis = analyzeReading(captureAt(fromNs(framesNs(0, 667, MAX_GAP_NS)), flat), CONTEXT);
    expect(analysis.cleanSeconds).toBe(0);
  });

  // FAILS on cf3a4cc, the same cause in a reading: 75 s of 75 bpm pulse at 30 fps, then 40 s of the red
  // held constant (a frozen frame) at exactly 150 ms per frame. Observed: 24 s of the frozen stretch
  // counted clean (99.0 of 115.05 s), so a Full Scan with 75 clean seconds is { kind: 'reading' }. Expected:
  // inconclusive, tooFewCleanSeconds.
  it('75 s of pulse then 40 s frozen at 150 ms per frame stays under a Full Scan of clean seconds', () => {
    const offsets = [...run30(0, 75), ...framesNs(75e9 + MAX_GAP_NS, 267, MAX_GAP_NS)].map((ns) => ns / 1e9);
    const frozen = pulse(75);
    const analysis = analyzeReading(
      captureAt(offsets, (tS) => (tS <= 75 ? pulse(tS) : frozen)),
      CONTEXT,
    );
    expect(analysis.cleanSeconds).toBeLessThan(DSP_CONFIG.rules.modeMinCleanS.full);
    expect(readingOutcome(withoutRate(analysis))).toMatchObject({
      kind: 'inconclusive',
      reasons: ['tooFewCleanSeconds', 'noHeartRate'],
    });
  });

  // At 30 fps with an interval of exactly 150 ms after every 26: frames every 150 ms throughout are under
  // live.minEffectiveFps, and their windows are rejected for that (ADR 0077).
  it('the split does not reject real signal: a pulse with 150 ms intervals has no flat span', () => {
    const offsetsNs = [0];
    for (let k = 1; offsetsNs[offsetsNs.length - 1]! < 60e9; k++)
      offsetsNs.push(offsetsNs[offsetsNs.length - 1]! + (k % 27 === 0 ? MAX_GAP_NS : Math.round(1e9 / 30)));
    const capture = captureAt(fromNs(offsetsNs), pulse);
    const analysis = analyzeReading(capture, CONTEXT);
    expect(analysis.rejectedSpans.filter((span) => span.reason === 'quality')).toEqual([]);
    expect(analysis.cleanSeconds).toBe(analysis.durationS);
  });

  it('live and saved agree on constant red at exactly 150 ms per frame (both split it alike)', () => {
    const capture = captureAt(fromNs(framesNs(0, 200, MAX_GAP_NS)), flat);
    const session = replay(capture);
    const saved = savedFrom(session);
    expect(saved.rejectedSpans).toEqual(session.rejectedSpans);
    expect(saved.cleanSeconds).toBe(session.cleanSeconds);
  });
});

describe('red team: the live ring completes, then a late rejection leaves the capture short of it', () => {
  // KNOWN LIMITATION (ADR 0042, ADR 0072 Consequences: Track A should finish on the true count). The ring
  // never steps back, so a rejection that arrives after it reached the target leaves the saved count
  // below it. These bound the shortfall: one SQI window (dsp3.modelWindowS) for a late score, and
  // live.minFlatS plus the capture screen's latency for a flat stretch. Frame gaps cannot cause it: a gap
  // span arrives with the frame that ends it (the gap tests above), and the unscored spans after a gap
  // start at that frame (reading-outcome-edges.test.ts).
  // Advisory SQI-Net (owner 2026-10-06): a late low score leaves no shortfall at all; it only flags a window.
  it('the last window scored unclean after the ring reached 30 s: no shortfall, one flagged window', () => {
    const capture = captureAt(regularOffsets(30, 30.05), pulse);
    const session = replay(capture, { score: (endS) => (endS < 29 ? 0.9 : null) });
    expect(session.cleanSeconds).toBeGreaterThanOrEqual(30);
    session.setSqi(session.sqiWindow!.endS, 0.1);
    const saved = savedFrom(session, 'quick');
    expect(saved.cleanSeconds).toBeCloseTo(session.cleanSeconds, 9);
    expect(saved.sqiFlagged!.windows).toBe(1);
    expect(readingOutcome(saved).kind).toBe('reading');
  });

  it('red frozen from 28.5 s, ring at 30 s, stopped 0.5 s later: shortfall ≤ minFlatS + 0.5 s', () => {
    const frozen = pulse(28.5);
    const capture = captureAt(regularOffsets(30, 30.55), (tS) => (tS < 28.5 ? pulse(tS) : frozen));
    let completedAtS: number | null = null;
    const session = replay(capture, {
      score: () => 0.9,
      onBatch: (live, lastS) => {
        if (completedAtS === null && live.cleanSeconds >= 30) completedAtS = lastS;
      },
    });
    expect(completedAtS).not.toBeNull();
    const saved = savedFrom(session, 'quick');
    expect(saved.cleanSeconds).toBeLessThan(30);
    expect(readingOutcome(saved).kind).toBe('reading');
    const shortfallS = session.cleanSeconds - saved.cleanSeconds;
    expect(shortfallS).toBeGreaterThan(0);
    expect(shortfallS).toBeLessThanOrEqual(DSP_CONFIG.live.minFlatS + 0.5);
    expect(saved.cleanSeconds).toBe(cleanSeconds(0, saved.durationS, session.rejectedSpans));
  });
});
