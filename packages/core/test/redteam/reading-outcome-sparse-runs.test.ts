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
  type Sample,
} from '../../src';
import { beatTimes, beatTrain, type Channels } from './attacks';

// Red team PR #171 round 9 (at 1ac78ac): ADR 0077 note 6 needs live.minDistinctSamplesPerS (15) sample
// times live.distinctSampleS (12 ms) apart in every 1 s span, on top of notes 4 and 5, the 16-frame 1 s
// floor and 96 frames per 4 s. Invariants: an accepted reading is within 5 bpm of its pulse (ANSI/AAMI
// EC13) or the capture is refused; live and saved agree; ordinary phones finish each mode; no lifted
// second is clean. SQI is a fixed stand-in for the model; a still finger; batches of 3 frames. Finding M
// is fixed by note 7 (live.maxSparseRunS): its cases must now be refused.

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
const HALF_NS_S = 0.5e-9;
const TARGETS = DSP_CONFIG.rules.modeMinCleanS as Record<string, number>;

const toNsGrid = (tS: number) => Math.round(tS * 1e9) / 1e9;
const steadyPulse = (bpm: number): Channels => beatTrain(beatTimes([60 / bpm], 800), 0.3);

// Sinusoidal pulse with a second (and third) harmonic, as round 8: a finger PPG's sharp upstroke puts
// real energy in its harmonics, which beatTrain's 70 ms Gaussians mostly smooth away.
function harmonicPulse(bpm: number, second: number, third = 0): Channels {
  const fundamentalHz = bpm / 60;
  return (tS) => {
    const phase = 2 * Math.PI * fundamentalHz * tS;
    const volume = Math.sin(phase) + second * Math.sin(2 * phase + 0.7) + third * Math.sin(3 * phase + 1.3);
    return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
  };
}

// The app's loop: each new SQI-Net window scored pClean (none when null), stopping once the live counter
// shows stopAtCleanS, then the saved analysis.
function replay(
  offsetsS: number[],
  pulse: Channels,
  captureFps: number,
  mode = 'quick',
  stopAtCleanS = Infinity,
  pClean: number | null = 0.9,
): { analysis: ReadingAnalysis; liveCleanS: number } {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const tS of offsetsS) {
    const offsetNs = Math.round(tS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    samples.push({ tNs, ...pulse(offsetNs / 1e9) });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  const session = createLiveSession({
    captureFps,
    sqiThreshold: 0.5,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  let scoredEndS: number | null = null;
  for (let start = 0; start < samples.length; start += 3) {
    session.pushSamples({ samples: samples.slice(start, start + 3), stats: stats.slice(start, start + 3) });
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

// ADR 0104 (owner, 2026-10-05): a capture with any heart rate is a reading. A standard rate must still be
// within 5 bpm; without one, the reading shows the lower-quality rate, which the result tags as such.
function expectAccurateOrRefused(analysis: ReadingAnalysis, trueBpm: number): void {
  if (readingOutcome(analysis).kind !== 'reading') return;
  if (analysis.heartRateBpm === null) {
    expect(analysis.lowQuality.heartRateBpm).not.toBeNull();
    return;
  }
  expect(Math.abs(analysis.heartRateBpm - trueBpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
}

// Sample times from a cycled list of intervals in ms; each gets `copies` extra frames 1 ms after it, which
// add to the frame counts but not to note 6's distinct samples. An interval runs from the last copy.
function fromIntervals(totalS: number, gapsMs: number[], copies: number): number[] {
  const offsetsS: number[] = [];
  for (let tS = 0, k = 0; tS <= totalS; k++) {
    for (let c = 0; c <= copies; c++) offsetsS.push(toNsGrid(tS + c / 1000));
    tS += (copies + gapsMs[k % gapsMs.length]!) / 1000;
  }
  return offsetsS.filter((tS) => tS <= totalS);
}

const repeat = (ms: number, times: number): number[] => Array<number>(times).fill(ms);

// Fewest frames in any closed span of spanS that starts on a frame, as the 96-frame and 1 s counts.
function fewestFramesIn(offsetsS: number[], spanS: number): number {
  let fewest = Infinity;
  let end = 0;
  for (let i = 0; offsetsS[i]! + spanS <= offsetsS[offsetsS.length - 1]!; i++) {
    while (end < offsetsS.length && offsetsS[end]! <= offsetsS[i]! + spanS) end++;
    fewest = Math.min(fewest, end - i);
  }
  return fewest;
}

// The most neighbouring-frame intervals over longerThanS in one closed 1 s span, from the first one's start
// to the last one's end, as notes 4 and 5 measure them.
function mostIntervalsIn1s(offsetsS: number[], longerThanS: number): number {
  const startsS: number[] = [];
  let oldest = 0;
  let most = 0;
  for (let i = 1; i < offsetsS.length; i++) {
    if (offsetsS[i]! - offsetsS[i - 1]! <= longerThanS + HALF_NS_S) continue;
    startsS.push(offsetsS[i - 1]!);
    while (offsetsS[i]! - startsS[oldest]! > DSP_CONFIG.live.subWindowS + HALF_NS_S) oldest++;
    most = Math.max(most, startsS.length - oldest);
  }
  return most;
}

// Fewest sample times live.distinctSampleS apart in any 1 s span that starts on a frame, as note 6.
function fewestDistinctIn1s(offsetsS: number[]): number {
  const { distinctSampleS, subWindowS } = DSP_CONFIG.live;
  let fewest = Infinity;
  for (let i = 0; offsetsS[i]! + subWindowS <= offsetsS[offsetsS.length - 1]!; i++) {
    let samples = 1;
    let lastS = offsetsS[i]!;
    for (let k = i + 1; k < offsetsS.length && offsetsS[k]! <= offsetsS[i]! + subWindowS + HALF_NS_S; k++) {
      if (offsetsS[k]! - lastS < distinctSampleS - HALF_NS_S) continue;
      samples++;
      lastS = offsetsS[k]!;
    }
    fewest = Math.min(fewest, samples);
  }
  return fewest;
}

function expectEveryFloorPasses(offsetsS: number[]): void {
  const { live } = DSP_CONFIG;
  expect(fewestFramesIn(offsetsS, DSP_CONFIG.dsp3.modelWindowS)).toBeGreaterThanOrEqual(
    live.minEffectiveFps * DSP_CONFIG.dsp3.modelWindowS,
  );
  expect(fewestFramesIn(offsetsS, live.subWindowS)).toBeGreaterThanOrEqual(
    live.minSubWindowFps * live.subWindowS,
  );
  expect(mostIntervalsIn1s(offsetsS, live.maxFrameGapS)).toBeLessThan(2);
  expect(mostIntervalsIn1s(offsetsS, live.sparseIntervalS)).toBeLessThan(live.maxSparseIntervalsPerS);
  expect(fewestDistinctIn1s(offsetsS)).toBeGreaterThanOrEqual(live.minDistinctSamplesPerS * live.subWindowS);
}

const evenFrames = (fps: number, totalS: number): number[] =>
  Array.from({ length: Math.floor(totalS * fps) + 1 }, (_, k) => toNsGrid(k / fps));

describe('red team M: note 6 counts distinct samples, not their spacing, so a burst pays for a sparse rest', () => {
  // 40 s, Quick, SQI 0.9. Each 1 s holds a burst of samples 12–30 ms apart (+ copies 1 ms apart), which
  // brings note 6's count to 15 or more, while the rest of the second is sampled every 77–121 ms: 8–13 Hz,
  // under the 14.7 Hz that note 6 means to enforce for the 7.33 Hz 2nd harmonic of 220 bpm. Every floor
  // passes (checked first); at 1ac78ac every second counts clean (≈ 39.9 s), live = saved, and these read
  // (true bpm → read):
  // 20 ms × 4 + 75 ms × 11, 2 copies, no interval over 0.09 s at all, harmonics 0.5/0.25, 220 → 110.3;
  // 120 × 4 + 12 × 6 + 80 × 5, 2 copies, 0.5, 220 → 111.4; 120 × 3 + 12 × 4 + 80 × 7, 1 copy, 0.5,
  // 220 → 112.3; 110 × 2 + 12 × 10 + 80 × 8, 1 copy, 0.5/0.25, 210 → 106.1; 120 × 4 + 30 × 8 + 89 × 2,
  // 1 copy, 0.5/0.25, 210 → 107.0; 120 × 4 + 20 × 8 + 89 × 3, 1 copy, 0.5/0.25, 210 → 182.3;
  // 12 × 4 + 80 × 11, 1 copy, 0.5/0.25, 220 → 208.8. beatTrain at 150–220 bpm read right on all of them,
  // and every pulse here reads within 3 bpm at 24, 30 and 60 fps (the controls below).
  it.each([
    ['20 ms × 4 + 75 ms × 11', 2, 220, 0.5, 0.25, [...repeat(20, 4), ...repeat(75, 11)]],
    [
      '120 ms × 4 + 12 ms × 6 + 80 ms × 5',
      2,
      220,
      0.5,
      0,
      [...repeat(120, 4), ...repeat(12, 6), ...repeat(80, 5)],
    ],
    [
      '120 ms × 3 + 12 ms × 4 + 80 ms × 7',
      1,
      220,
      0.5,
      0,
      [...repeat(120, 3), ...repeat(12, 4), ...repeat(80, 7)],
    ],
    [
      '110 ms × 2 + 12 ms × 10 + 80 ms × 8',
      1,
      210,
      0.5,
      0.25,
      [...repeat(110, 2), ...repeat(12, 10), ...repeat(80, 8)],
    ],
    [
      '120 ms × 4 + 30 ms × 8 + 89 ms × 2',
      1,
      210,
      0.5,
      0.25,
      [...repeat(120, 4), ...repeat(30, 8), ...repeat(89, 2)],
    ],
    [
      '120 ms × 4 + 20 ms × 8 + 89 ms × 3',
      1,
      210,
      0.5,
      0.25,
      [...repeat(120, 4), ...repeat(20, 8), ...repeat(89, 3)],
    ],
    ['12 ms × 4 + 80 ms × 11', 1, 220, 0.5, 0.25, [...repeat(12, 4), ...repeat(80, 11)]],
  ] as [string, number, number, number, number, number[]][])(
    '%s, %i copies, %i bpm, harmonics %f / %f: no standard rate (note 7)',
    (_, copies, bpm, second, third, gapsMs) => {
      const offsetsS = fromIntervals(40, gapsMs, copies);
      expectEveryFloorPasses(offsetsS);
      const { analysis, liveCleanS } = replay(offsetsS, harmonicPulse(bpm, second, third), 30);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
      expect(analysis.heartRateBpm).toBeNull();
      expectAccurateOrRefused(analysis, bpm);
    },
  );

  it.each([
    [24, 220, 0.5, 0.25],
    [30, 220, 0.5, 0.25],
    [60, 220, 0.5, 0.25],
    [24, 220, 0.5, 0],
    [30, 210, 0.5, 0.25],
    [24, 210, 0.5, 0.25],
  ])('control: %i fps exact reads %i bpm with harmonics %f / %f', (fps, bpm, second, third) => {
    const { analysis } = replay(evenFrames(fps, 40), harmonicPulse(bpm, second, third), fps);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - bpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
  });
});

// Park–Miller (16807, mod 2³¹ − 1) uniforms on (0, 1), so a seed names a jitter and drop pattern.
function uniformsFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

// fps frames through totalS, each moved by up to ±jitterS and dropped at dropsPerS a second on average.
function jittered(fps: number, totalS: number, jitterS: number, dropsPerS: number, seed: number): number[] {
  const uniform = uniformsFrom(seed);
  const offsetsS: number[] = [];
  for (let k = 0; k / fps <= totalS; k++) {
    const tS = k / fps + (2 * uniform() - 1) * jitterS;
    if (uniform() >= dropsPerS / fps && tS >= 0) offsetsS.push(toNsGrid(tS));
  }
  return offsetsS.sort((a, b) => a - b);
}

// 30 fps delivered in uneven pairs: one frame every 1/15 s and its partner offsetMs later.
function unevenPairs(totalS: number, offsetMs: number): number[] {
  const offsetsS: number[] = [];
  for (let k = 0; k / 15 <= totalS; k++) offsetsS.push(toNsGrid(k / 15), toNsGrid(k / 15 + offsetMs / 1000));
  return offsetsS.filter((tS) => tS <= totalS);
}

describe('red team: ordinary phones finish Quick, Full and Deep (75 bpm, SQI 0.9)', () => {
  // Stops when the live counter shows the mode's target. At 1ac78ac the durations were: 30 fps ±8 ms with
  // no drops and every evenly-timed or paired case, target + ≤ 0.1 s; 3 drops per s, Quick 35.1, Full
  // 95.0, Deep 317.1; 4 drops per s, Deep 329.1–343.0 s; 5 drops per s, Quick 56.0, Full 151.0.
  const cases: [string, string, number, (totalS: number) => number[], number][] = [];
  for (const mode of ['quick', 'full', 'deep']) {
    const slackS = mode === 'deep' ? 20 : 6;
    cases.push(
      ['30 fps ±8 ms, no drops', mode, 30, (t) => jittered(30, t, 0.008, 0, 71993), slackS],
      ['30 fps ±8 ms, 3 drops per s', mode, 30, (t) => jittered(30, t, 0.008, 3, 71993), slackS],
      ['24 fps exact', mode, 24, (t) => evenFrames(24, t), 1],
      ['60 fps ±2 ms, 3 drops per s', mode, 60, (t) => jittered(60, t, 0.002, 3, 81239), 1],
      ['120 fps ±1 ms', mode, 120, (t) => jittered(120, t, 0.001, 0, 81239), 1],
      ['30 fps in pairs 12.5 ms apart', mode, 30, (t) => unevenPairs(t, 12.5), 1],
      ['30 fps in pairs 20 ms apart', mode, 30, (t) => unevenPairs(t, 20), 1],
    );
  }
  cases.push(
    ['240 fps ±0.5 ms, 10 drops per s', 'quick', 240, (t) => jittered(240, t, 0.0005, 10, 81239), 1],
    ['240 fps ±0.5 ms, 10 drops per s', 'full', 240, (t) => jittered(240, t, 0.0005, 10, 81239), 1],
    ['30 fps ±8 ms, 4 drops per s, seed 12345', 'deep', 30, (t) => jittered(30, t, 0.008, 4, 12345), 50],
    ['30 fps ±8 ms, 5 drops per s', 'quick', 30, (t) => jittered(30, t, 0.008, 5, 71993), 27],
    ['30 fps ±8 ms, 5 drops per s', 'full', 30, (t) => jittered(30, t, 0.008, 5, 71993), 62],
  );

  it.each(cases)('%s, %s: a reading, live = saved', (_, mode, fps, frames, slackS) => {
    const targetS = TARGETS[mode]!;
    const { analysis, liveCleanS } = replay(
      frames(targetS + slackS + 5),
      steadyPulse(75),
      fps,
      mode,
      targetS,
    );
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(analysis.durationS).toBeLessThan(targetS + slackS);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
  });
});

describe('red team: a 30 fps phone dropping 5 frames per s finishes Deep, slowly', () => {
  // ±8 ms, 5 random drops per s (25 fps mean), 75 bpm, SQI 0.9. At 1ac78ac it takes 501.3 / 498.3 / 407.0 s
  // for seeds 71993 / 12345 / 99991, inside the session's 13 500-frame buffer (540 s at 25 fps), past which
  // it throws. Switching rules off in DSP_CONFIG.live: the 96-frame floor alone gives 482.3 / 496.3 /
  // 407.0 s; every rule but it, 345.1 / 348.2 / 325.1 s; no rule, 338.1 / 335.2 / 325.1 s.
  it.each([71993, 12345, 99991])('seed %i: a Deep reading within 505 s', (seed) => {
    const { analysis, liveCleanS } = replay(
      jittered(30, 530, 0.008, 5, seed),
      steadyPulse(75),
      30,
      'deep',
      300,
    );
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(analysis.durationS).toBeLessThan(505);
  });
});

describe('red team: periodic short finger lifts against the 15 s heart-rate floor (ADR 0080)', () => {
  // 30 fps for 40 s, lifted frames r = g = b = 0.1 (coverage), n frames every periodS from phaseS. A
  // sweep of 600 cases (periods 0.8–5 s, 1–10 frames, two phases, 60–190 bpm, SQI 0.9 or none) found no
  // wrong heart rate, no lifted second clean, and live = saved at 1ac78ac; 149 of them have ≥ 30 clean s but
  // too few accepted intervals and are refused (noHeartRate). These are a sample.
  function lifted(periodS: number, frames: number, phaseS: number) {
    return (tS: number) => tS >= phaseS && (tS - phaseS) % periodS < frames / 30 - 1e-6;
  }

  it.each([
    [0.8, 1, 0.45, 75, 0.9],
    [0.8, 4, 0.45, 110, 0.9],
    [1.3, 2, 0.1, 150, 0.9],
    [2, 3, 0.45, 190, null],
    [3.1, 4, 0.1, 60, null],
    [5, 10, 0.45, 75, 0.9],
    [2, 6, 0.1, 110, null],
  ])(
    'every %p s, %i frames from %p s, %i bpm, SQI %p: right or refused, no lifted second clean',
    (periodS, frames, phaseS, bpm, pClean) => {
      const isLifted = lifted(periodS, frames, phaseS);
      const pulse = steadyPulse(bpm);
      const channels: Channels = (tS) => (isLifted(tS) ? { r: 0.1, g: 0.1, b: 0.1 } : pulse(tS));
      const offsetsS = evenFrames(30, 40);
      const { analysis, liveCleanS } = replay(offsetsS, channels, 30, 'quick', Infinity, pClean);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
      expectAccurateOrRefused(analysis, bpm);
      const liftSpans = offsetsS
        .filter(isLifted)
        .map((tS) => ({ startS: tS, endS: tS + 1 / 30 - 1e-6, reason: 'quality' as const }));
      const lastS = offsetsS[offsetsS.length - 1]!;
      expect(
        cleanSeconds(0, lastS, analysis.rejectedSpans) -
          cleanSeconds(0, lastS, [...analysis.rejectedSpans, ...liftSpans]),
      ).toBeLessThan(1e-6);
    },
  );
});
