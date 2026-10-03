import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  readingOutcome,
  type CaptureStatus,
  type LiveSession,
  type ReadingAnalysis,
  type ReadingContext,
} from '../../src';
import { captureAt, jitteredOffsets, type SyntheticCapture } from '../synthetic';
import { beatTimes, beatTrain, withRed, type Channels } from './attacks';

// Red team for 808f37c (PR #171, ADR 0072 and its addendum). The invariants: the outcome flips exactly
// where the whole-ns clean count crosses the mode's target, whatever the frame rate and wherever the
// DSP-2 gap sits; the live count and the saved analysis agree however the frames are batched; and a
// capture accepted as a reading carries a heart rate within 5 bpm of the pulse it was built from
// (ANSI/AAMI EC13's ±5 bpm, a criterion for the owner to confirm), or it is refused. Captures under
// live.minEffectiveFps (ADR 0077, owner's option C) are refused.

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

const MAX_GAP_NS = DSP_CONFIG.dsp2.maxGapS * 1e9;
const NEEDED = DSP_CONFIG.rules.modeMinCleanS;
const HR_TOLERANCE_BPM = 5;

const regularPulse = (bpm: number, dicroticRatio = 0.3): Channels =>
  beatTrain(beatTimes([60 / bpm], 400), dicroticRatio);

// Whole-ns frame offsets from fromNs, stepNs apart, up to and including toNs.
const framesNs = (fromNs: number, toNs: number, stepNs: number) =>
  Array.from({ length: Math.floor((toNs - fromNs) / stepNs) + 1 }, (_, k) => Math.round(fromNs + k * stepNs));
const toSeconds = (offsetsNs: number[]) => offsetsNs.map((offsetNs) => offsetNs / 1e9);

function judge(capture: SyntheticCapture, mode = 'full'): ReadingAnalysis {
  return analyzeReading(capture, { ...CONTEXT, mode });
}

function expectAccurateOrRefused(analysis: ReadingAnalysis, trueBpm: number): void {
  if (readingOutcome(analysis).kind !== 'reading') return;
  expect(Math.abs(analysis.heartRateBpm! - trueBpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
}

describe('red team: the mode target against one gap at dsp2.maxGapS, to the ns', () => {
  // Frames from 0 to 15 s, one interval of gapNs, then frames on to a last frame at target + gapNs + δ
  // (δ = ±1 ns), so the whole-ns clean count is target + δ with the gap lost, target + gapNs + δ without.
  const cases = (['quick', 'full'] as const).flatMap((mode) =>
    [30, 60, 240].flatMap((fps) =>
      [MAX_GAP_NS, MAX_GAP_NS + 1, 151e6].flatMap((gapNs) =>
        [-1, 1].map((deltaNs) => [mode, fps, gapNs, deltaNs] as const),
      ),
    ),
  );

  it.each(cases)(
    '%s at %i fps, a %i ns interval, the clean count %i ns off the target',
    (mode, fps, gapNs, deltaNs) => {
      const stepNs = 1e9 / fps;
      const before = framesNs(0, 15e9, stepNs);
      const resumeNs = before[before.length - 1]! + gapNs;
      const lastNs = NEEDED[mode] * 1e9 + gapNs + deltaNs;
      const after = framesNs(resumeNs, lastNs - 1, stepNs);
      const capture = captureAt(toSeconds([...before, ...after, lastNs]), regularPulse(75));
      const analysis = judge(capture, mode);
      const cleanNs = gapNs > MAX_GAP_NS ? lastNs - gapNs : lastNs;
      expect(Math.round(analysis.cleanSeconds * 1e9)).toBe(cleanNs);
      expect(readingOutcome(analysis).kind).toBe(cleanNs >= NEEDED[mode] * 1e9 ? 'reading' : 'inconclusive');
    },
  );

  it.each([
    ['the first interval', 0],
    ['the last interval', 1],
  ])('a 150 000 001 ns gap as %s of a Quick Check is lost', (_, last) => {
    const body = framesNs(0, 30e9, 1e9 / 30);
    const offsetsNs = last
      ? [...body, body[body.length - 1]! + MAX_GAP_NS + 1]
      : [0, ...body.map((offsetNs) => offsetNs + MAX_GAP_NS + 1)];
    const analysis = judge(captureAt(toSeconds(offsetsNs), regularPulse(75)), 'quick');
    expect(Math.round(analysis.cleanSeconds * 1e9)).toBe(30e9);
    expect(readingOutcome(analysis).kind).toBe('reading');
  });

  // n gaps of 150 000 001 ns spread over a Full Scan whose last frame leaves the whole-ns clean count at
  // 90 s ± 1 ns: each gap must be lost in full, and only once.
  it.each([
    [10, -1],
    [10, 1],
    [200, -1],
    [200, 1],
  ])('%i gaps of 150 000 001 ns, clean count %i ns off 90 s', (gapCount, deltaNs) => {
    const gapNs = MAX_GAP_NS + 1;
    const stretchNs = 90e9 / gapCount;
    const offsetsNs: number[] = [];
    let fromNs = 0;
    for (let k = 0; k < gapCount; k++) {
      const stretch = framesNs(fromNs, fromNs + stretchNs - 1, 1e9 / 30);
      offsetsNs.push(...stretch);
      fromNs = stretch[stretch.length - 1]! + gapNs;
    }
    const lastNs = 90e9 + gapCount * gapNs + deltaNs;
    offsetsNs.push(...framesNs(fromNs, lastNs - 1, 1e9 / 30), lastNs);
    const analysis = judge(captureAt(toSeconds(offsetsNs), regularPulse(75)));
    const gapsNs = offsetsNs
      .slice(1)
      .map((offsetNs, i) => offsetNs - offsetsNs[i]!)
      .filter((intervalNs) => intervalNs > MAX_GAP_NS)
      .reduce((sum, intervalNs) => sum + intervalNs, 0);
    expect(Math.round(analysis.cleanSeconds * 1e6)).toBe(Math.round((lastNs - gapsNs) / 1e3));
    // With 200 gaps every DSP-2 segment but the last is under dsp7.minSegmentS, so its beats span about
    // 3 s: under DSP-11's 15 s of accepted intervals (ADR 0080), so there is no heart rate. Until PR #171
    // round 3 this read from 4 intervals.
    const reasons = [
      ...(lastNs - gapsNs >= 90e9 ? [] : ['tooFewCleanSeconds']),
      ...(gapCount === 200 ? ['noHeartRate'] : []),
    ];
    const outcome = readingOutcome(analysis);
    expect(outcome.kind === 'inconclusive' ? outcome.reasons : []).toEqual(reasons);
    expect(outcome.kind).toBe(reasons.length > 0 ? 'inconclusive' : 'reading');
  });
});

describe('red team: sparse frames with no DSP-2 gap (dropped frames, thermal throttling)', () => {
  // Failed on 808f37c: only intervals > dsp2.maxGapS were lost, so frames at most 150 ms apart counted as
  // wholly clean and a fast pulse aliased (all { kind: 'reading' }, ≈ 99.9 clean s of 100 s): 220 bpm at
  // 150 ms → 191.5 bpm; 210 bpm at 150 ms → 197.5; 120 bpm at 140 ms → 112.6; 210 bpm keeping 1 of 4 frames
  // at 30 fps → 220.9; 190 bpm at 8 fps → 176.3; 190 bpm at 7 fps → 201.7. ADR 0077 (owner, option C): a
  // model window under live.minEffectiveFps is rejected, so these are refused.
  it.each([
    ['every 150 ms', 220, 150e6],
    ['every 150 ms', 210, 150e6],
    ['every 140 ms', 120, 140e6],
    ['keeping 1 frame in 4 at 30 fps', 210, 4e9 / 30],
    ['at 8 fps', 190, 125e6],
    ['at 7 fps', 190, 1e9 / 7],
  ])('a 100 s Full Scan with frames %s and a %i bpm pulse is refused', (_, bpm, stepNs) => {
    const analysis = judge(captureAt(toSeconds(framesNs(0, 100e9, stepNs)), regularPulse(bpm)));
    expect(readingOutcome(analysis).kind).toBe('inconclusive');
    expect(analysis.cleanSeconds).toBeLessThan(1);
  });

  // These read within 5 bpm on 808f37c; under ADR 0077 (owner, option C) they are below Lumen's 24 fps
  // floor (§5.1) and refused by design.
  it.each([60, 100, 130, 160, 190, 220])(
    'at 10, 12, and 15 fps (regular and jittered) %i bpm is refused',
    (bpm) => {
      for (const fps of [10, 12, 15])
        for (const offsets of [
          framesNs(0, 100e9, 1e9 / fps).map((ns) => ns / 1e9),
          jitteredOffsets(fps, 100, 0.3 / fps),
        ])
          expect(readingOutcome(judge(captureAt(offsets, regularPulse(bpm)))).kind).toBe('inconclusive');
    },
  );

  // The floor's edges: 24 fps and a jittered 30 fps still read; 30 fps dropping every 3rd frame (20 fps) is
  // refused.
  it.each([
    ['24 fps', framesNs(0, 100e9, 1e9 / 24).map((ns) => ns / 1e9), 'reading'],
    ['jittered 30 fps', jitteredOffsets(30, 100, 0.3 / 30), 'reading'],
    [
      '30 fps dropping every 3rd frame',
      framesNs(0, 100e9, 1e9 / 30)
        .filter((_, k) => k % 3 !== 2)
        .map((ns) => ns / 1e9),
      'inconclusive',
    ],
  ])('%s at 160 bpm: %s', (_, offsets, kind) => {
    const analysis = judge(captureAt(offsets, regularPulse(160)));
    expect(readingOutcome(analysis).kind).toBe(kind);
    expectAccurateOrRefused(analysis, 160);
  });
});

describe('red team: §16 waveform attacks with frame gaps', () => {
  // 30 fps, a 167 ms gap (4 frames dropped) after every whole second: loses 10 s of 100, so a Full Scan.
  const gapped = framesNs(0, 100e9, 1e9 / 30)
    .filter((offsetNs, k) => offsetNs < 1e9 || ![1, 2, 3, 4].includes(k % 30))
    .map((offsetNs) => offsetNs / 1e9);

  it.each([
    ['a dicrotic wave at 0.9 of the systolic one', beatTrain(beatTimes([0.8], 120), 0.9), 75],
    [
      'a premature beat (0.5 RR early) every 8th beat',
      beatTrain(beatTimes([0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.4, 1.2], 120)),
      75,
    ],
    [
      'a pulse deficit (every 5th beat has no pulse wave)',
      beatTrain(beatTimes([0.8], 120).filter((_, k) => k % 5 !== 4)),
      75,
    ],
    [
      '120 Hz flicker of 2% on the red (aliased to DC at 30 fps) and 100 Hz (to 10 Hz)',
      withRed(
        regularPulse(75),
        (tS) => 0.012 * Math.sin(2 * Math.PI * 120 * tS) + 0.012 * Math.sin(2 * Math.PI * 100 * tS),
      ),
      75,
    ],
    ['a cold-hands pulse of 0.05% at 50 bpm', beatTrain(beatTimes([1.2], 120), 0.3, 0.0003), 50],
  ])('%s: refused or within 5 bpm', (_, channels, bpm) => {
    expectAccurateOrRefused(judge(captureAt(gapped, channels)), bpm);
  });

  it('clipped frames on both sides of every gap: each lost second once, under pressure before quality', () => {
    const capture = captureAt(gapped, regularPulse(75));
    capture.stats.forEach((stat, i) => {
      const nextS = gapped[i + 1];
      const previousS = gapped[i - 1];
      const nearGap =
        (nextS !== undefined && nextS - gapped[i]! > 0.15) ||
        (previousS !== undefined && gapped[i]! - previousS > 0.15);
      if (nearGap) stat.clipFrac = 0.5;
    });
    const analysis = judge(capture);
    const outcome = readingOutcome(analysis);
    if (outcome.kind === 'reading') throw new Error('expected an inconclusive outcome');
    const { motion, pressure, coverage, coldHands } = outcome.lostSeconds;
    expect(
      outcome.cleanSeconds + motion + pressure + coverage + coldHands + outcome.otherLostSeconds,
    ).toBeCloseTo(analysis.durationS, 9);
    expect(outcome.lostSeconds.pressure).toBeLessThanOrEqual(analysis.lostSeconds.pressure + 1e-9);
  });
});

describe('red team: live and saved agree however frames are batched around gaps', () => {
  const still: CaptureStatus = {
    fingerCovered: true,
    motionRms: 0,
    thermal: 'nominal',
    fps: 30,
    droppedFrac: 0,
  };
  const moving: CaptureStatus = { ...still, motionRms: 10 };

  // splitAt says whether a batch ends after frame i; moveDuringGaps pushes a moving status while a gap is
  // open (the motion sensor keeps running while the camera stalls) and a still one after it.
  function replay(
    capture: SyntheticCapture,
    splitAt: (i: number) => boolean,
    moveDuringGaps: boolean,
  ): LiveSession {
    const session = createLiveSession({
      captureFps: 30,
      sqiThreshold: 0.5,
      perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
    });
    const startNs = capture.samples[0]!.tNs;
    const secondsOf = (i: number) => (capture.samples[i]!.tNs - startNs) / 1e9;
    let start = 0;
    let scoredEndS: number | null = null;
    for (let i = 0; i < capture.samples.length; i++) {
      if (!splitAt(i) && i < capture.samples.length - 1) continue;
      session.pushSamples({
        samples: capture.samples.slice(start, i + 1),
        stats: capture.stats.slice(start, i + 1),
      });
      const gapNext =
        i + 1 < capture.samples.length && secondsOf(i + 1) - secondsOf(i) > DSP_CONFIG.dsp2.maxGapS;
      session.pushStatus(moveDuringGaps && gapNext ? moving : still);
      const window = session.sqiWindow;
      if (window && window.endS !== scoredEndS) {
        scoredEndS = window.endS;
        session.setSqi(window.endS, 0.9);
      }
      start = i + 1;
    }
    return session;
  }

  const offsets = toSeconds([
    ...framesNs(0, 20e9, 1e9 / 30),
    ...framesNs(20e9 + MAX_GAP_NS + 1, 40e9, 1e9 / 30),
    ...framesNs(45e9, 70e9, 1e9 / 30),
    ...framesNs(70e9 + 151e6, 100e9, 1e9 / 30).filter((_, k) => k % 30 > 3),
  ]);
  const gapAfter = (i: number) => i + 1 < offsets.length && offsets[i + 1]! - offsets[i]! > 0.1;
  const batchings: [string, (i: number) => boolean][] = [
    ['one frame per batch', () => true],
    ['batches ending exactly before each gap', gapAfter],
    ['batches ending one frame after each gap', (i) => i > 0 && gapAfter(i - 1)],
    ['one batch for the whole capture', () => false],
    ['batches of 7 frames', (i) => i % 7 === 6],
  ];

  // Compared on the true count (cleanSeconds over the live spans): the ring's count never steps back
  // (ADR 0042), so it may run ahead; that is the next describe.
  it.each(
    batchings.flatMap(([name, splitAt]) => [false, true].map((move) => [name, move, splitAt] as const)),
  )('%s (moving during gaps: %p): same spans, clean seconds, and outcome', (_, move, splitAt) => {
    const capture = captureAt(offsets, regularPulse(75));
    const session = replay(capture, splitAt, move);
    const { capture: frames, ...spans } = session.readingInput();
    const saved = analyzeReading(frames, { ...CONTEXT, ...spans });
    expect(saved.rejectedSpans).toEqual(session.rejectedSpans);
    const liveTrueS = cleanSeconds(0, saved.durationS, session.rejectedSpans);
    expect(saved.cleanSeconds).toBe(liveTrueS);
    expect(readingOutcome(saved).kind).toBe(liveTrueS >= 90 ? 'reading' : 'inconclusive');
  });

  it('an exposure change on the first frame after a gap: the gap and the 1 s hold are each lost once', () => {
    const capture = captureAt(offsets, regularPulse(75));
    const resumeIndex = offsets.findIndex((tS) => tS >= 45);
    capture.stats.forEach((stat, i) => {
      if (i >= resumeIndex) stat.exposureNs = 9_000_000;
    });
    const analysis = judge(capture);
    const lostToGapsS = offsets
      .slice(1)
      .map((tS, i) => tS - offsets[i]!)
      .filter((intervalS) => intervalS > DSP_CONFIG.dsp2.maxGapS + 0.5e-9)
      .reduce((sum, intervalS) => sum + intervalS, 0);
    expect(analysis.durationS - analysis.cleanSeconds).toBeCloseTo(
      lostToGapsS + DSP_CONFIG.dsp5.exposureChangeArtifactS,
      6,
    );
  });

  // Failed on 808f37c. The existing suite says "Frame gaps cannot cause it" (the ring completing and the
  // saved count falling short). They can: after a gap SQI-Net has no gap-free 4 s window, so each tick adds
  // an unscored span (ADR 0057) reaching 4 s back, over seconds before the gap that the ring already
  // counted. Quick Check, 75 bpm at 30 fps, 100 ms batches, SQI 0.9 on every window: the ring reaches 30
  // at 30.00 s, the camera stalls 500 ms at 30.45 s (stopping), and frames run 0.5 s past completion.
  // Observed: saved 27.000 clean s, inconclusive (shortfall 3.433 s). A 2 s stall at 30.00–30.45 s:
  // saved 28.07–28.50, inconclusive. Expected: a Quick reading, as 30 s were clean before any gap. Fixed:
  // an unscored span starts at the end of the newest window that formed (model-window unscoredSpan).
  it.each([
    [500e6, 30.45],
    [2e9, 30.0],
    [2e9, 30.45],
  ])('a %i ns stall at %p s, after the ring reached 30 s, leaves a Quick reading', (stallNs, stallAtS) => {
    const before = framesNs(0, stallAtS * 1e9, 1e9 / 30);
    const capture = captureAt(
      toSeconds([...before, ...framesNs(before[before.length - 1]! + stallNs, 40e9, 1e9 / 30)]),
      regularPulse(75),
    );
    const session = createLiveSession({
      captureFps: 30,
      sqiThreshold: 0.5,
      perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
    });
    const secondsOf = (i: number) => (capture.samples[i]!.tNs - capture.samples[0]!.tNs) / 1e9;
    let scoredEndS: number | null = null;
    let completedAtS: number | null = null;
    for (let start = 0; start < capture.samples.length;) {
      let end = start + 1;
      while (end < capture.samples.length && secondsOf(end) < secondsOf(start) + 0.1) end++;
      session.pushSamples({
        samples: capture.samples.slice(start, end),
        stats: capture.stats.slice(start, end),
      });
      session.pushStatus(still);
      const window = session.sqiWindow;
      if (window && window.endS !== scoredEndS) {
        scoredEndS = window.endS;
        session.setSqi(window.endS, 0.9);
      }
      const lastS = secondsOf(end - 1);
      if (completedAtS === null && session.cleanSeconds >= 30) completedAtS = lastS;
      if (completedAtS !== null && lastS >= completedAtS + 0.5) break;
      start = end;
    }
    expect(completedAtS).not.toBeNull();
    const { capture: frames, ...spans } = session.readingInput();
    expect(readingOutcome(analyzeReading(frames, { ...CONTEXT, mode: 'quick', ...spans })).kind).toBe(
      'reading',
    );
  });
});

describe('red team: the model window tests a 150 ms interval without the half-ns allowance', () => {
  // Failed on 808f37c. model-window.ts usableFrom and windowFrames still tested tS[i] − tS[i − 1] >
  // dsp2.maxGapS directly; 808f37c moved only FlatRuns onto isFrameGap. An interval of exactly
  // 150 000 000 ns (some compute as 0.15000000000000002 s) is not a DSP-2 gap, yet no SQI-Net window
  // formed over it. Observed with frames every 150 ms; since ADR 0077 those windows are under
  // live.minEffectiveFps, so here 30 fps frames have one interval of stepNs after every 26.
  // Expected: 150 000 000 ns behaves as 149 999 999 ns.
  const withLongIntervals = (stepNs: number) => {
    const offsetsNs = [0];
    for (let k = 1; offsetsNs[offsetsNs.length - 1]! < 60e9; k++)
      offsetsNs.push(offsetsNs[offsetsNs.length - 1]! + (k % 27 === 0 ? stepNs : Math.round(1e9 / 30)));
    return toSeconds(offsetsNs);
  };
  const newSession = () =>
    createLiveSession({
      captureFps: 30,
      sqiThreshold: 0.5,
      perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
    });

  it('an interval of 150 000 000 ns can compute as more than dsp2.maxGapS', () => {
    const offsets = withLongIntervals(150e6);
    expect(offsets.some((tS, i) => i > 0 && tS - offsets[i - 1]! > DSP_CONFIG.dsp2.maxGapS)).toBe(true);
  });

  it.each([149_999_999, 150_000_000])(
    'an interval of %i ns every 27 frames: SQI-Net gets windows',
    (stepNs) => {
      const capture = captureAt(withLongIntervals(stepNs), regularPulse(75));
      const session = newSession();
      let windows = 0;
      capture.samples.forEach((sample, i) => {
        session.pushSamples({ samples: [sample], stats: [capture.stats[i]!] });
        if (session.sqiWindow) windows++;
      });
      expect(windows).toBeGreaterThan(0);
    },
  );

  // windowFrames: once SQI-Net has scored every window clean, no 4 s is left unscored, live or saved.
  it.each([149_999_999, 150_000_000])(
    'an interval of %i ns every 27 frames, every window scored clean: all clean',
    (stepNs) => {
      const capture = captureAt(withLongIntervals(stepNs), regularPulse(75));
      const session = newSession();
      let scoredEndS: number | null = null;
      capture.samples.forEach((sample, i) => {
        session.pushSamples({ samples: [sample], stats: [capture.stats[i]!] });
        const window = session.sqiWindow;
        if (window && window.endS !== scoredEndS) {
          scoredEndS = window.endS;
          session.setSqi(window.endS, 0.9);
        }
      });
      const { capture: frames, ...spans } = session.readingInput();
      expect(spans.sqi).not.toBeNull();
      const saved = analyzeReading(frames, { ...CONTEXT, ...spans });
      expect(session.rejectedSpans).toEqual([]);
      expect(saved.rejectedSpans).toEqual([]);
      expect(saved.cleanSeconds).toBe(saved.durationS);
    },
  );

  // usableFrom: the cold-hands check needs 4 s of covered, gap-free frames; 150 ms apart is gap-free, and
  // cold hands does not depend on the frame-rate floor.
  it.each([149_999_999, 150_000_000])(
    'frames every %i ns with a 0.05%% pulse: cold hands is found',
    (stepNs) => {
      const capture = captureAt(
        toSeconds(framesNs(0, 60e9, stepNs)),
        beatTrain(beatTimes([1.2], 60), 0.3, 0.0003),
      );
      const session = newSession();
      capture.samples.forEach((sample, i) =>
        session.pushSamples({ samples: [sample], stats: [capture.stats[i]!] }),
      );
      expect(session.readingInput().coldHandsSpans.length).toBeGreaterThan(0);
    },
  );

  // ADR 0077 (owner, option C): frames every 150 ms (6.67 fps) never reach SQI-Net, and live and saved
  // reject the same windows, so the capture is refused whether or not SQI-Net ran.
  it.each([149_999_999, 150_000_000])(
    'frames every %i ns: no window for SQI-Net, live and saved refuse alike',
    (stepNs) => {
      const capture = captureAt(toSeconds(framesNs(0, 60e9, stepNs)), regularPulse(75));
      const session = newSession();
      let windows = 0;
      capture.samples.forEach((sample, i) => {
        session.pushSamples({ samples: [sample], stats: [capture.stats[i]!] });
        if (session.sqiWindow) windows++;
      });
      expect(windows).toBe(0);
      const { capture: frames, ...spans } = session.readingInput();
      const saved = analyzeReading(frames, { ...CONTEXT, mode: 'quick', ...spans });
      expect(saved.rejectedSpans).toEqual(session.rejectedSpans);
      expect(cleanSeconds(0, saved.durationS, session.rejectedSpans)).toBe(saved.cleanSeconds);
      expect(saved.cleanSeconds).toBeLessThan(1);
      expect(readingOutcome(saved).kind).toBe('inconclusive');
    },
  );
});
