import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  readingOutcome,
  type CaptureStatus,
  type FrameStat,
  type ReadingAnalysis,
  type ReadingContext,
  type RejectedSpan,
  type Sample,
} from '../../src';
import { jitteredOffsets } from '../synthetic';
import { beatTimes, beatTrain } from './attacks';

// Red team for c6ccd6a (PR #171, 47b95bb): unscoredSpan from the newest formed window's end, and ADR 0077
// option C (a 4 s model window with fewer than live.minEffectiveFps × 4 frames is rejected). The B and C
// cases failed there; uncovered frames leaving the beat signal, DSP-11's 15 s of accepted intervals
// (ADR 0080), and ADR 0077's 1 s sub-window floor (live.minSubWindowFps) fix them. Invariants: no
// lifted, unscored, or never-scored second counts clean; live and saved agree; a capture accepted as a
// reading carries a heart rate within 5 bpm of its pulse (ANSI/AAMI EC13, as reading-outcome-edges), or it
// is refused. SQI is a fixed stand-in for the model; a still finger; batches of 3 frames.

const CONTEXT: ReadingContext = {
  captureFps: 30,
  tier: 'basic',
  mode: 'quick',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};
const STILL: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 30,
  droppedFrac: 0,
};
const CLOCK_START_NS = 5_000_000_000_000;
const HR_TOLERANCE_BPM = 5;
const WINDOW_S = DSP_CONFIG.dsp3.modelWindowS;

// A lifted frame shows ambient light: equal channels (fails DSP-4's red ratio), level `liftedLevel`.
interface Frame {
  tS: number;
  liftedLevel: number | null;
}

// Frame times in whole ns, fps from fromS through toS.
const framesS = (fromS: number, toS: number, fps: number): number[] =>
  Array.from(
    { length: Math.floor((toS - fromS) * fps + 1e-9) + 1 },
    (_, k) => Math.round(fromS * 1e9 + (k * 1e9) / fps) / 1e9,
  );

const covered = (offsets: number[]): Frame[] => offsets.map((tS) => ({ tS, liftedLevel: null }));

// 30 fps to untilS with the finger lifted over [liftS, liftS + liftedS).
function withLift(untilS: number, liftS: number, liftedS: number, level: number): Frame[] {
  return framesS(0, untilS, 30).map((tS) => ({
    tS,
    liftedLevel: tS >= liftS && tS < liftS + liftedS ? level : null,
  }));
}

function capture(frames: Frame[], bpm: number): { samples: Sample[]; stats: FrameStat[] } {
  const pulse = beatTrain(beatTimes([60 / bpm], 800), 0.3);
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const { tS, liftedLevel } of frames) {
    const offsetNs = Math.round(tS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    const channels =
      liftedLevel === null ? pulse(offsetNs / 1e9) : { r: liftedLevel, g: liftedLevel, b: liftedLevel };
    samples.push({ tNs, ...channels });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

interface Replay {
  analysis: ReadingAnalysis;
  liveCleanS: number;
  scoredEnds: number[];
}

// The app's loop: each new SQI-Net window scored pClean (none when pClean is null), then the saved analysis.
function replay(frames: Frame[], bpm: number, pClean: number | null, captureFps = 30): Replay {
  const { samples, stats } = capture(frames, bpm);
  const session = createLiveSession({
    captureFps,
    sqiThreshold: 0.5,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  const scoredEnds: number[] = [];
  for (let start = 0; start < samples.length; start += 3) {
    session.pushSamples({ samples: samples.slice(start, start + 3), stats: stats.slice(start, start + 3) });
    session.pushStatus(STILL);
    const window = session.sqiWindow;
    if (pClean !== null && window && window.endS !== scoredEnds[scoredEnds.length - 1]) {
      scoredEnds.push(window.endS);
      session.setSqi(window.endS, pClean);
    }
  }
  const lastS = frames[frames.length - 1]!.tS;
  const liveCleanS = cleanSeconds(0, lastS, session.rejectedSpans);
  const { capture: saved, ...spans } = session.readingInput();
  return {
    analysis: analyzeReading(saved, { ...CONTEXT, captureFps, ...spans }),
    liveCleanS,
    scoredEnds,
  };
}

// Clean seconds up to the last scored window's end that lie in no scored window.
function neverScoredCleanS(analysis: ReadingAnalysis, scoredEnds: number[]): number {
  const lastEndS = scoredEnds[scoredEnds.length - 1]!;
  const outsideWindows: RejectedSpan[] = [];
  let reachedS = 0;
  for (const endS of scoredEnds) {
    if (endS - WINDOW_S > reachedS)
      outsideWindows.push({ startS: reachedS, endS: endS - WINDOW_S, reason: 'quality' });
    reachedS = Math.max(reachedS, endS);
  }
  return (
    cleanSeconds(0, lastEndS, analysis.rejectedSpans) -
    cleanSeconds(0, lastEndS, [...analysis.rejectedSpans, ...outsideWindows])
  );
}

function expectAccurateOrRefused(analysis: ReadingAnalysis, trueBpm: number): void {
  if (readingOutcome(analysis).kind !== 'reading') return;
  expect(Math.abs(analysis.heartRateBpm! - trueBpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
}

describe('red team: seconds around a finger lift (47b95bb unscoredSpan from the newest window)', () => {
  // Passed on c6ccd6a too: the lifted time is a coverage span, nothing clean is outside a scored window, and live
  // and saved agree, for a lift on a check, mid-window, before the first window, at the start, after a
  // stall, before a stall, repeated every 3 s, and every other frame lifted for 6 s.
  const cases: [string, Frame[], [number, number][]][] = [
    ['0.5 s lift at 20 s', withLift(40, 20, 0.5, 0.05), [[20, 20.5]]],
    ['0.1 s lift at 20 s (splined)', withLift(40, 20, 0.1, 0.05), [[20, 20.1]]],
    ['0.5 s lift at 20.5 s (mid-window)', withLift(40, 20.5, 0.5, 0.05), [[20.5, 21]]],
    ['0.5 s lift at 2 s (before the first window)', withLift(40, 2, 0.5, 0.05), [[2, 2.5]]],
    ['0.3 s lift at 0 s', withLift(40, 0, 0.3, 0.05), [[0, 0.3]]],
    [
      'lift 20–20.5 s, then a stall to 21 s',
      [...withLift(20.5, 20, 0.5, 0.05), ...covered(framesS(21, 40, 30))],
      [[20, 20.5]],
    ],
    [
      'a stall 20–20.3 s, then a lift to 20.6 s',
      [
        ...covered(framesS(0, 20, 30)),
        ...framesS(20.3, 40, 30).map((tS) => ({ tS, liftedLevel: tS < 20.6 ? 0.05 : null })),
      ],
      [[20.3, 20.6]],
    ],
    [
      'every other frame lifted, 15–21 s',
      framesS(0, 40, 30).map((tS, k) => ({ tS, liftedLevel: tS >= 15 && tS < 21 && k % 2 ? 0.05 : null })),
      [],
    ],
  ];
  const repeated = withLift(60, 0, 0, 0.05);
  const repeatedLifts: [number, number][] = [];
  for (let liftS = 6; liftS < 58; liftS += 3) {
    repeatedLifts.push([liftS, liftS + 0.2]);
    for (const frame of repeated) if (frame.tS >= liftS && frame.tS < liftS + 0.2) frame.liftedLevel = 0.05;
  }
  cases.push(['0.2 s lifts every 3 s', repeated, repeatedLifts]);

  it.each(cases)('%s: no lifted or never-scored second is clean; live = saved', (_, frames, lifts) => {
    const { analysis, liveCleanS, scoredEnds } = replay(frames, 75, 0.9);
    for (const [fromS, toS] of lifts) expect(cleanSeconds(fromS, toS, analysis.rejectedSpans)).toBe(0);
    expect(neverScoredCleanS(analysis, scoredEnds)).toBeLessThan(1e-6);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
  });

  it('0.2 s lifts every 3 s with every window vetoed (pClean 0): nothing clean', () => {
    expect(replay(repeated, 75, 0).analysis.cleanSeconds).toBe(0);
  });
});

describe('red team: one 0.5 s finger lift in a Quick Check is accepted with a wrong heart rate', () => {
  // Failed on c6ccd6a. 75 bpm at 30 fps for 40 s, the finger lifted once for 0.5 s (lifted frames
  // r = g = b = level: coverage). The lifted frames stay in DSP-7's signal (only broken frames are left out),
  // and the step swamps beat detection over the whole segment: in the first case only 4 beats are found in
  // 40 s (18.94, 19.24, 20.93, 22.12 s), the last two artifacts, so heartRate is 60 / 0.298 s from one
  // interval while cleanSeconds is 35.0. Observed {kind: 'reading'}:
  // SQI 0.9 on every window: lift 20.50 s level 0.05 → 201.1 bpm; 19.75 s level 0.2 → 193.2; 20.50 s
  // level 0.2 → 203.7. b146460 refused these three (noHeartRate): its 4 s-back unscored span made the
  // 18.94/19.24 s beats artifacts; 47b95bb's span starts at 19.969 s, so they count.
  // No SQI (pre-existing on b146460 too): 20.00 s level 0.05 → 123.6; 20.50 → 201.1; 21.00 → 231.8; a 1 s
  // lift at 20.50 s → 145.9; level 0.2 at 19.75 → 193.2, 20.00 → 121.4, 20.75 → 119.0, 21.00 → 226.2.
  it.each([
    [20.5, 0.5, 0.05, 0.9],
    [19.75, 0.5, 0.2, 0.9],
    [20.5, 0.5, 0.2, 0.9],
    [20.0, 0.5, 0.05, null],
    [21.0, 0.5, 0.05, null],
    [20.5, 1, 0.05, null],
    [20.0, 0.5, 0.2, null],
    [20.75, 0.5, 0.2, null],
    [21.0, 0.5, 0.2, null],
  ])(
    'lift at %p s for %p s, ambient level %p, SQI %p: 75 bpm or refused',
    (liftS, liftedS, level, pClean) => {
      expectAccurateOrRefused(replay(withLift(40, liftS, liftedS, level), 75, pClean).analysis, 75);
    },
  );

  // Control (passed on c6ccd6a): a 1 s lift at level 0.2 reads 75.0 bpm.
  it('control: a 1 s lift at 20 s, level 0.2, SQI 0.9 reads 75 bpm', () => {
    const { analysis } = replay(withLift(40, 20, 1, 0.2), 75, 0.9);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
  });
});

describe('red team: bursts of fast frames pad a sparse window past the 96-frame floor (ADR 0077)', () => {
  // Failed on c6ccd6a. The floor counts frames per 4 s window, so a fast burst carries the rest of the window:
  // at 120 fps, 0.6 s of frames (72) plus 3.4 s at 125 ms (27) is 99 ≥ 96 frames. Every 4 s repeats it, no
  // interval > 150 ms, 120 s, saved analysis without SQI, captureFps = the burst rate. Observed {kind:
  // 'reading'}, ≈ 119.9 clean s: 120 fps 0.6 s + 125 ms, 220 bpm → 232.0; 120 fps 0.6 s + 140 ms, 190 bpm
  // → 198.3; 120 fps 0.8 s + 125 ms, 220 bpm → 229.3; 240 fps 0.5 s + 125 ms, 220 bpm → 232.2; 240 fps
  // 0.5 s + 140 ms, 220 bpm → 213.4; 240 fps 0.5 s + 125 ms, 190 bpm → 182.3. 120 fps 0.5 s bursts (60 +
  // 28 frames) are refused (0.88 clean s). Live with SQI 0.9 gives the same: 240 fps 0.5 s + 7 fps, 220 bpm
  // → 207.1, 199.9 clean s, live = saved.
  const bursts = (fastFps: number, burstS: number, slowStepS: number, untilS: number) => {
    const offsets: number[] = [];
    for (let fromS = 0; fromS < untilS; fromS += 4) {
      offsets.push(...framesS(fromS, fromS + burstS, fastFps));
      for (let tS = fromS + burstS + slowStepS; tS < fromS + 4 - 1e-9; tS += slowStepS)
        offsets.push(Math.round(tS * 1e9) / 1e9);
    }
    return offsets;
  };

  it.each([
    [120, 0.6, 0.125, 220],
    [120, 0.6, 0.14, 190],
    [120, 0.8, 0.125, 220],
    [240, 0.5, 0.125, 220],
    [240, 0.5, 0.14, 220],
    [240, 0.5, 0.125, 190],
  ])(
    '%i fps bursts of %p s, then frames %p s apart, %i bpm: accurate or refused',
    (fps, burstS, stepS, bpm) => {
      const analysis = analyzeReading(capture(covered(bursts(fps, burstS, stepS, 120)), bpm), {
        ...CONTEXT,
        captureFps: fps,
      });
      expectAccurateOrRefused(analysis, bpm);
    },
  );

  it('live, SQI 0.9: 240 fps 0.5 s bursts then 7 fps, 220 bpm: accurate or refused, live = saved', () => {
    const offsets: number[] = [];
    for (let fromS = 0; fromS < 200; fromS += 4)
      offsets.push(...framesS(fromS, fromS + 0.5, 240), ...framesS(fromS + 0.5 + 1 / 7, fromS + 3.99, 7));
    const { analysis, liveCleanS } = replay(covered(offsets), 220, 0.9, 30);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expectAccurateOrRefused(analysis, 220);
  });
});

describe('red team: a 24 fps capture with sub-ms jitter falls under the 24 fps floor (ADR 0077)', () => {
  // An exact 24 fps stream puts exactly 24 frames in each 1 s part of a model window, so jitter that moves
  // one boundary frame out leaves 23 and the window is rejected. 60 s at 24 fps, 100 bpm, saved analysis
  // without SQI. This errs toward refusing; whether to allow slack is an open owner question in ADR 0077,
  // so these pin today's behaviour rather than the red team's proposed one.
  it.each([0.0001, 0.001, 0.003])(
    'KNOWN LIMITATION: 24 fps jittered ±%p s, Quick, 60 s, is refused',
    (amplitudeS) => {
      const analysis = analyzeReading(capture(covered(jitteredOffsets(24, 60, amplitudeS)), 100), CONTEXT);
      expect(readingOutcome(analysis).kind).toBe('inconclusive');
    },
  );

  // Controls (passed on c6ccd6a): exact 24 fps; 24.05 fps jittered ±1 ms; 30 fps dropping 1 frame in 5 (24 fps mean).
  it.each([
    ['exact 24 fps', framesS(0, 60, 24)],
    ['24.05 fps jittered ±1 ms', jitteredOffsets(24.05, 60, 0.001)],
    ['30 fps dropping 1 frame in 5', framesS(0, 60, 30).filter((_, k) => k % 5 !== 4)],
  ])('control: %s reads', (_, offsets) => {
    const analysis = analyzeReading(capture(covered(offsets), 100), CONTEXT);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 100)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
  });
});
