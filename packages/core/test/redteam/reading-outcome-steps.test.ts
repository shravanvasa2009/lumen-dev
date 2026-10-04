import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  heartRate,
  readingOutcome,
  type CaptureStatus,
  type ClassifiedBeat,
  type FrameStat,
  type ReadingAnalysis,
  type ReadingContext,
  type Sample,
} from '../../src';
import { beatTimes, beatTrain, type Channels } from './attacks';

// Red team for 1363bd9 (PR #171, b9896c7, ADR 0080 and ADR 0077's 1 s sub-window note): uncovered frames
// leave the beat signal, heartRate needs 15 s of accepted intervals, and every 1 s of a model window needs
// live.minSubWindowFps frames. Invariants: no lifted second counts clean; live and saved agree; a capture
// accepted as a reading carries a heart rate within 5 bpm of its pulse (ANSI/AAMI EC13, as
// reading-outcome-edges), or it is refused; TypeScript and Python give the same heart rate on the same
// beats. SQI is a fixed stand-in for the model; a still finger; batches of 3 frames. The round's DSP-7
// step cases (one red step DSP-4 does not catch) wait for the DSP-7 change in ADR 0081.

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
const AMBIENT = { r: 0.05, g: 0.05, b: 0.05 }; // a lifted finger: equal channels fail DSP-4's red ratio

type Frame = { r: number; g: number; b: number };
// What the camera sees at tS, given the finger's pulse frame there.
type Scene = (tS: number, finger: Frame) => Frame;

// Frame times in whole ns, fps from fromS through toS.
const framesS = (fromS: number, toS: number, fps: number): number[] =>
  Array.from(
    { length: Math.floor((toS - fromS) * fps + 1e-9) + 1 },
    (_, k) => Math.round(fromS * 1e9 + (k * 1e9) / fps) / 1e9,
  );

const steadyPulse = (bpm: number): Channels => beatTrain(beatTimes([60 / bpm], 400), 0.3);

function capture(
  offsetsS: number[],
  pulse: Channels,
  scene: Scene | null = null,
): { samples: Sample[]; stats: FrameStat[] } {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const tS of offsetsS) {
    const offsetNs = Math.round(tS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    const finger = pulse(offsetNs / 1e9);
    samples.push({ tNs, ...(scene ? scene(offsetNs / 1e9, finger) : finger) });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

interface Replay {
  analysis: ReadingAnalysis;
  liveCleanS: number;
}

// The app's loop: each new SQI-Net window scored pClean (none when null), stopping once the live counter
// shows stopAtCleanS, then the saved analysis.
function replay(
  frames: { samples: Sample[]; stats: FrameStat[] },
  pClean: number | null,
  captureFps = 30,
  mode = 'quick',
  stopAtCleanS = Infinity,
): Replay {
  const session = createLiveSession({
    captureFps,
    sqiThreshold: 0.5,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  let scoredEndS: number | null = null;
  for (let start = 0; start < frames.samples.length; start += 3) {
    session.pushSamples({
      samples: frames.samples.slice(start, start + 3),
      stats: frames.stats.slice(start, start + 3),
    });
    session.pushStatus(STILL);
    const window = session.sqiWindow;
    if (pClean !== null && window && window.endS !== scoredEndS) {
      scoredEndS = window.endS;
      session.setSqi(window.endS, pClean);
    }
    if (session.cleanSeconds >= stopAtCleanS) break;
  }
  const { capture: saved, ...spans } = session.readingInput();
  const lastS = (saved.samples[saved.samples.length - 1]!.tNs - saved.samples[0]!.tNs) / 1e9;
  return {
    analysis: analyzeReading(saved, { ...CONTEXT, captureFps, mode, ...spans }),
    liveCleanS: cleanSeconds(0, lastS, session.rejectedSpans),
  };
}

// Clean time from each uncovered frame to the next frame: what contactSpans must reject.
function uncoveredCleanS(samples: Sample[], analysis: ReadingAnalysis): number {
  const startNs = samples[0]!.tNs;
  let clean = 0;
  samples.forEach((sample, i) => {
    const broken = ![sample.r, sample.g, sample.b].every((channel) => channel >= 0 && channel <= 1);
    const next = samples[i + 1];
    if (next && (broken || sample.r < 2 * (sample.g + sample.b)))
      clean += cleanSeconds((sample.tNs - startNs) / 1e9, (next.tNs - startNs) / 1e9, analysis.rejectedSpans);
  });
  return clean;
}

function expectAccurateOrRefused(analysis: ReadingAnalysis, trueBpm: number): void {
  if (readingOutcome(analysis).kind !== 'reading') return;
  expect(Math.abs(analysis.heartRateBpm! - trueBpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
}

const liftedOver =
  (spans: [number, number][], frame: Frame = AMBIENT): Scene =>
  (tS, finger) =>
    spans.some(([fromS, toS]) => tS >= fromS && tS < toS - 1e-9) ? frame : finger;

describe('red team: uncovered frames leave the beat signal (ADR 0080, passes at 1363bd9)', () => {
  // A lift of 133 ms at 30 fps leaves a 167 ms gap and splits; at 240 fps 145 ms is splined and 150 ms
  // splits. Either way the lifted time is rejected, live = saved, and the rate is right or refused.
  const cases: [number, number, number | null][] = [];
  for (const fps of [30, 60, 240])
    for (const liftMs of [140, 150, 160]) for (const pClean of [0.9, null]) cases.push([fps, liftMs, pClean]);
  it.each(cases)('%i fps, one %i ms lift at 20.05 s, SQI %p', (fps, liftMs, pClean) => {
    const frames = capture(
      framesS(0, 40, fps),
      steadyPulse(75),
      liftedOver([[20.05, 20.05 + liftMs / 1000]]),
    );
    const { analysis, liveCleanS } = replay(frames, pClean, fps);
    expect(uncoveredCleanS(frames.samples, analysis)).toBe(0);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expectAccurateOrRefused(analysis, 75);
  });

  // The frames on a lift's edges pass DSP-4 while the light ramps, so part of the step stays in the
  // signal. Red ramps linearly to ambient over rampS, holds 0.5 s, and ramps back; saved, no SQI.
  it.each([
    [0.6, 0.1],
    [0.6, 0.4],
    [0.9, 0.1],
    [0.9, 0.4],
  ])('lift edges: finger level %p, ramps of %p s, 75 bpm', (level, rampS) => {
    const holdS = 0.5;
    const liftS = 20;
    const depth = (tS: number) => {
      const intoS = tS - liftS;
      if (intoS < 0 || intoS >= 2 * rampS + holdS) return 0;
      if (intoS < rampS) return intoS / rampS;
      return intoS < rampS + holdS ? 1 : 1 - (intoS - rampS - holdS) / rampS;
    };
    const ramped: Scene = (tS, finger) => {
      const f = depth(tS);
      const r = finger.r + level - 0.6;
      return {
        r: r + (AMBIENT.r - r) * f,
        g: finger.g + (AMBIENT.g - finger.g) * f,
        b: finger.b + (AMBIENT.b - finger.b) * f,
      };
    };
    expectAccurateOrRefused(
      analyzeReading(capture(framesS(0, 40, 30), steadyPulse(75), ramped), CONTEXT),
      75,
    );
  });

  const repeated = (everyS: number, liftedS: number): [number, number][] => {
    const spans: [number, number][] = [];
    for (let fromS = 3.01; fromS < 39; fromS += everyS) spans.push([fromS, fromS + liftedS]);
    return spans;
  };
  it.each([
    [0.8, 0.1],
    [0.8, 0.133],
    [2, 0.1],
    [2, 0.133],
  ])('a lift every %p s, each %p s long, SQI 0.9', (everyS, liftedS) => {
    const frames = capture(framesS(0, 40, 30), steadyPulse(75), liftedOver(repeated(everyS, liftedS)));
    const { analysis, liveCleanS } = replay(frames, 0.9);
    expect(uncoveredCleanS(frames.samples, analysis)).toBe(0);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expectAccurateOrRefused(analysis, 75);
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['200 (a 0–255 value)', 200],
  ])('broken frames (red %s) for 133 ms every 3 s, SQI 0.9', (_, red) => {
    const frames = capture(framesS(0, 40, 30), steadyPulse(75), (tS, finger) =>
      repeated(3, 0.133).some(([fromS, toS]) => tS >= fromS && tS < toS - 1e-9)
        ? { ...finger, r: red }
        : finger,
    );
    const { analysis, liveCleanS } = replay(frames, 0.9);
    expect(uncoveredCleanS(frames.samples, analysis)).toBe(0);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expectAccurateOrRefused(analysis, 75);
  });
});

// Park–Miller (16807, mod 2³¹ − 1) uniforms on (0, 1), so a seed names a drop pattern.
function uniformsFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}
// 30 fps for 60 s with each frame dropped independently, dropsPerS on average.
const randomDrops = (dropsPerS: number, seed: number): number[] => {
  const uniform = uniformsFrom(seed);
  return framesS(0, 60, 30).filter(() => uniform() >= dropsPerS / 30);
};

describe('red team: random frame drops above 24 fps finish a Quick Check (ADR 0077 note)', () => {
  // Failed on 1363bd9, whose rule was 24 frames in every 1 s. 30 fps with 4 frames in 30 dropped at random
  // (26 fps on average, above §5.1's 24 fps floor), 75 bpm, Quick, SQI 0.9, stopping when the live counter
  // shows 30 s. Random drops leave some 1 s stretches with 19–22 frames, and every model window holding
  // one was rejected: these three seeds took 71.0, 88.1 and 77.1 s, so a 60 s capture was refused. With
  // 16 frames per 1 s (ADR 0077 option D's Nyquist bound) they take 30.0, 30.0 and 30.1 s, as at c6ccd6a.
  it.each([6, 7, 12])('4 random drops per s, seed %i × 7919, 60 s: a Quick reading', (k) => {
    const { analysis } = replay(capture(randomDrops(4, k * 7919), steadyPulse(75)), 0.9, 30, 'quick', 30);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(analysis.durationS).toBeLessThan(40);
  });

  // Controls (pass on 1363bd9): 1–2 random drops per s finish within 37.0 s on every seed tried.
  it.each([
    [1, 1],
    [2, 4],
    [2, 8],
  ])('control: %i random drops per s, seed %i × 7919: reads within 40 s', (dropsPerS, k) => {
    const { analysis } = replay(
      capture(randomDrops(dropsPerS, k * 7919), steadyPulse(75)),
      0.9,
      30,
      'quick',
      30,
    );
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(analysis.durationS).toBeLessThan(40);
  });
});

describe('red team: DSP-11 floor of 15 s of accepted intervals, float boundaries (ADR 0080)', () => {
  // Passes on 1363bd9. The same beats as ml/tests/redteam/test_redteam_heart_rate_floor.py, which asserts
  // the same values on ml/lumen_dsp/metrics.py heart_rate: peaks first + step × k summed in index order.
  const beats = (
    firstS: number,
    stepS: number,
    intervals: number,
    artifacts: number[] = [],
  ): ClassifiedBeat[] =>
    Array.from({ length: intervals + 1 }, (_, k) => ({
      peakS: firstS + stepS * k,
      onsetS: null,
      beatClass: artifacts.includes(k) ? 'artifact' : 'normal',
      longPause: false,
    }));
  it.each([
    ['20 × 0.75 s from 0 s: sums to exactly 15', [beats(0, 0.75, 20)], 80],
    ['20 × 0.75 s from 1.4 s: sums to 14.999999999999998', [beats(1.4, 0.75, 20)], null],
    ['20 × 0.75 s from 1.1 s: sums to 15.000000000000002', [beats(1.1, 0.75, 20)], 80],
    ['20 × (14.999999 / 20) s', [beats(1, 14.999999 / 20, 20)], null],
    ['20 × (15.000001 / 20) s', [beats(1, 15.000001 / 20, 20)], 79.99999466666705],
    ['two segments of 10 × 0.75 s', [beats(0, 0.75, 10), beats(20, 0.75, 10)], 80],
    ['22 × 0.75 s, beat 10 an artifact: 15 s left', [beats(0, 0.75, 22, [10])], 80],
    ['20 × 0.75 s, beat 10 an artifact: 13.5 s left', [beats(0, 0.75, 20, [10])], null],
  ])('%s', (_, segments, expected) => {
    expect(heartRate(segments, 30)).toBe(expected);
  });
});

describe('red team: mode targets still give readings in ordinary conditions (passes at 1363bd9)', () => {
  // A still finger, SQI 0.9, stopping when the live counter shows the mode's target.
  it.each([
    ['quick', 30, 75],
    ['quick', 60, 42],
    ['quick', 240, 180],
    ['full', 30, 42],
    ['deep', 30, 75],
  ])('%s at %i fps, %i bpm: a reading, live = saved', (mode, fps, bpm) => {
    const targetS = DSP_CONFIG.rules.modeMinCleanS[mode as keyof typeof DSP_CONFIG.rules.modeMinCleanS];
    const { analysis, liveCleanS } = replay(
      capture(framesS(0, targetS + 10, fps), steadyPulse(bpm)),
      0.9,
      fps,
      mode,
      targetS,
    );
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - bpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
  });
});
