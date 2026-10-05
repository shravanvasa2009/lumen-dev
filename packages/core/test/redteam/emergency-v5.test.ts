import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  emergencyHeartRate,
  readingOutcome,
  type CaptureStatus,
  type FrameStat,
  type ReadingAnalysis,
  type ReadingContext,
  type Sample,
  type UrgentHeartRate,
} from '../../src';
import { beatTimes, beatTrain, type Channels } from './attacks';

// Red team PR #242 at a88af8a (SAFE-1, ADR 0076, option A): the emergency view leaves out the windows
// ADR 0077's frame floor rejects (notes 1–7), as it leaves out SQI-Net's. These replay the #171 rounds'
// adversarial frame timings (H, I, K, L, M, N) and even or dropped 12–23 fps through the app's loop (SQI
// 0.9 stand-in unless stated, a still finger, batches of 3 frames), 95 s, Full Scan, rest timer done.
// Option B (a88af8a reverted) was measured with the same grid in a checkout of 2363668.
//
// Measured (grid below, 50–110 bpm without 75, 4 pulses, 24 timings): false fastSustained or slowBelow40
// 0 / 672 with A and 0 / 672 with B. Fast 160–200 bpm reaching fastSustained: A 447 / 480, B 60 / 480
// (B hits only the N and random-drop timings, which partly pass the floor). Outcome, HR and clean seconds
// are identical under A and B in all 1176 replays: A changes only `urgent`.

const TOTAL_S = 95;
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
const STILL: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 30,
  droppedFrac: 0,
};
const CLOCK_START_NS = 5_000_000_000_000;
const P_CLEAN = 0.9;
const SLOW_TEST_MS = 600_000;

const toNsGrid = (tS: number) => Math.round(tS * 1e9) / 1e9;
const repeat = (ms: number, times: number): number[] => Array<number>(times).fill(ms);
const evenFrames = (fps: number, totalS: number): number[] =>
  Array.from({ length: Math.floor(totalS * fps) + 1 }, (_, k) => toNsGrid(k / fps));

// Sinusoidal pulse with a second and third harmonic (rounds 8–10): a finger PPG's sharp upstroke puts
// real energy in its harmonics, which beatTrain's 70 ms Gaussians mostly smooth away.
function harmonicPulse(bpm: number, second: number, third: number): Channels {
  const fundamentalHz = bpm / 60;
  return (tS) => {
    const phase = 2 * Math.PI * fundamentalHz * tS;
    const volume = Math.sin(phase) + second * Math.sin(2 * phase + 0.7) + third * Math.sin(3 * phase + 1.3);
    return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
  };
}

const dicroticTrain = (bpm: number, dicroticRatio: number): Channels =>
  beatTrain(beatTimes([60 / bpm], TOTAL_S + 5), dicroticRatio);

const PULSES: Record<string, (bpm: number) => Channels> = {
  'beatTrain, dicrotic 0.3': (bpm) => dicroticTrain(bpm, 0.3),
  'beatTrain, dicrotic 0.6 (strong)': (bpm) => dicroticTrain(bpm, 0.6),
  'harmonics 0.5 / 0.25': (bpm) => harmonicPulse(bpm, 0.5, 0.25),
  'harmonics 0.8 / 0.4': (bpm) => harmonicPulse(bpm, 0.8, 0.4),
};

// Sample times from a cycled list of intervals in ms; each gets `copies` extra frames 1 ms after it (round
// 9–10's fromIntervals, round 6–8's clusters). An interval runs from the last copy.
function fromIntervals(totalS: number, gapsMs: number[], copies: number): number[] {
  const offsetsS: number[] = [];
  for (let tS = 0, k = 0; tS <= totalS; k++) {
    for (let c = 0; c <= copies; c++) offsetsS.push(toNsGrid(tS + c / 1000));
    tS += (copies + gapsMs[k % gapsMs.length]!) / 1000;
  }
  return offsetsS.filter((tS) => tS <= totalS);
}

// Round 7's lone-interval allowance (K): one longMs interval, then shortMs ones until the next long one
// ends more than 1 s after this one starts.
function oneLongPerSpan(longMs: number, shortMs: number): number[] {
  return [longMs, ...repeat(shortMs, Math.floor((1000 - 2 * longMs) / shortMs) + 1)];
}

// Round 8's (L) four long intervals in a row, then the fewest short ones that keep five out of any 1 s.
function fourLongInARow(longMs: number, shortMs: number, copies: number): number[] {
  let shorts = 0;
  while (4 * (longMs + copies) + shorts * (shortMs + copies) + longMs <= 1001) shorts++;
  return [...repeat(longMs, 4), ...repeat(shortMs, shorts)];
}

// A gridFps camera clock keeping, per periodSteps steps, `run` consecutive frames and then one frame every
// everySteps steps (rounds 3–4, H and I).
function clustered(totalS: number, gridFps: number, periodSteps: number, run: number, everySteps: number) {
  const steps: number[] = [];
  for (let base = 0; base / gridFps <= totalS; base += periodSteps) {
    for (let j = 0; j < run; j++) steps.push(base + j);
    for (let j = run - 1 + everySteps; j < periodSteps; j += everySteps) steps.push(base + j);
  }
  return steps.map((step) => toNsGrid(step / gridFps)).filter((tS) => tS <= totalS);
}

// Round 5's clumps (I): each second, `clump` frames spacingMs apart (+ copies 1 ms apart), then frames
// evenly spread at most DSP-2's gap limit apart to the next second.
function clumped(totalS: number, clump: number, spacingMs: number, copies: number): number[] {
  const offsetsS: number[] = [];
  for (let baseS = 0; baseS <= totalS; baseS += 1) {
    for (let k = 0; k < clump; k++)
      for (let c = 0; c <= copies; c++) offsetsS.push(baseS + (k * spacingMs) / 1000 + c / 1000);
    const clumpEndS = baseS + ((clump - 1) * spacingMs) / 1000;
    const restS = baseS + 1 - clumpEndS;
    const gaps = Math.ceil(restS / DSP_CONFIG.dsp2.maxGapS - 1e-9);
    for (let k = 1; k < gaps; k++) offsetsS.push(clumpEndS + (k * restS) / gaps);
  }
  return offsetsS.filter((tS) => tS <= totalS).map(toNsGrid);
}

// Park–Miller (16807, mod 2³¹ − 1) uniforms on (0, 1), so a seed names a drop pattern.
function uniformsFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

const randomDrops = (fps: number, totalS: number, dropsPerS: number, seed: number): number[] => {
  const uniform = uniformsFrom(seed);
  return evenFrames(fps, totalS).filter(() => uniform() >= dropsPerS / fps);
};

// [name, capture fps, frame times, clean seconds of 95 at a88af8a (75 bpm)]. The first 20 are refused by
// ADR 0077's floor in (nearly) every window, so option A hands the emergency rule beats the reading itself
// refuses. The N timings pass every floor (round 10's accepted finding N), and random drops pass in places.
const TIMINGS: [string, number, number[], number][] = [
  ['K even 120 ms + 2 copies', 30, fromIntervals(TOTAL_S, [118], 2), 0.9],
  ['K even 110 ms + 2 copies', 30, fromIntervals(TOTAL_S, [108], 2), 0.9],
  ['K one 150 ms + 119 ms, 3 copies', 30, fromIntervals(TOTAL_S, oneLongPerSpan(150, 119), 3), 0.9],
  ['H 240 fps, 20-frame runs then every 36 steps', 240, clustered(TOTAL_S, 240, 240, 20, 36), 0],
  ['H 240 fps, 18-frame runs then every 24 steps', 240, clustered(TOTAL_S, 240, 240, 18, 24), 0],
  ['I 12 times 20.834 ms apart + 2 copies, then ≤ 150 ms', 240, clumped(TOTAL_S, 12, 20.834, 2), 0],
  ['I 240 fps, 80-frame runs then every 36 steps', 240, clustered(TOTAL_S, 240, 240, 80, 36), 0],
  [
    'L four 120 ms in a row + 85 ms, 2 copies',
    30,
    fromIntervals(TOTAL_S, fourLongInARow(120, 85, 2), 2),
    1.0,
  ],
  [
    'L four 119 ms in a row + 89 ms, 3 copies',
    30,
    fromIntervals(TOTAL_S, fourLongInARow(119, 89, 3), 3),
    0.9,
  ],
  [
    'M 20 ms × 4 + 75 ms × 11, 2 copies',
    30,
    fromIntervals(TOTAL_S, [...repeat(20, 4), ...repeat(75, 11)], 2),
    1.0,
  ],
  [
    'M 120 ms × 4 + 12 ms × 6 + 80 ms × 5, 2 copies',
    30,
    fromIntervals(TOTAL_S, [...repeat(120, 4), ...repeat(12, 6), ...repeat(80, 5)], 2),
    1.0,
  ],
  ['even 12 fps', 30, evenFrames(12, TOTAL_S), 0],
  ['even 15 fps', 30, evenFrames(15, TOTAL_S), 0],
  ['even 18 fps', 30, evenFrames(18, TOTAL_S), 0],
  ['even 20 fps', 30, evenFrames(20, TOTAL_S), 0],
  ['even 23 fps', 30, evenFrames(23, TOTAL_S), 0],
  ['30 fps, every 3rd frame dropped (20 fps)', 30, evenFrames(30, TOTAL_S).filter((_, k) => k % 3 !== 1), 0],
  ['N pairs 16 ms + 89 ms apart, 1 copy', 30, fromIntervals(TOTAL_S, [15, 88], 1), 94.9],
  [
    'N 12 ms × 6 + 80 ms × 6, 1 copy',
    30,
    fromIntervals(TOTAL_S, [...repeat(12, 6), ...repeat(80, 6)], 1),
    95.0,
  ],
  [
    'N 12 ms × 6 + 75 ms × 5, no copies',
    30,
    fromIntervals(TOTAL_S, [...repeat(12, 6), ...repeat(75, 5)], 0),
    95.0,
  ],
  ['30 fps, 8 random drops per s, seed 7919 (22 fps)', 30, randomDrops(30, TOTAL_S, 8, 7919), 3.9],
  ['24 fps, 4 random drops per s, seed 4242 (20 fps)', 30, randomDrops(24, TOTAL_S, 4, 4242), 14.2],
  ['20 fps, 3 random drops per s, seed 777 (17 fps)', 30, randomDrops(20, TOTAL_S, 3, 777), 12.5],
  ['15 fps, 2 random drops per s, seed 12345 (13 fps)', 30, randomDrops(15, TOTAL_S, 2, 12345), 14.9],
];

function capture(
  offsetsS: number[],
  pulse: Channels,
  lifted: (tS: number) => boolean,
): { samples: Sample[]; stats: FrameStat[] } {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const tS of offsetsS) {
    const offsetNs = Math.round(tS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    // A lifted finger leaves ambient light on the sensor, a DSP-4 coverage failure (ADR 0080's case).
    const frame = lifted(offsetNs / 1e9) ? { r: 0.05, g: 0.05, b: 0.05 } : pulse(offsetNs / 1e9);
    samples.push({ tNs, ...frame });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

interface Replay {
  analysis: ReadingAnalysis;
  liveCleanS: number;
  // The full capture analysed with the session's spans, as analyzeReading would see it without the loop.
  direct: ReadingAnalysis;
}

// The app's loop: each new SQI-Net window scored pClean (none when null), then the saved analysis.
function replay(
  offsetsS: number[],
  pulse: Channels,
  captureFps: number,
  pClean: number | null = P_CLEAN,
  lifted: (tS: number) => boolean = () => false,
): Replay {
  const frames = capture(offsetsS, pulse, lifted);
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
  }
  const { capture: saved, ...spans } = session.readingInput();
  const lastS = (saved.samples[saved.samples.length - 1]!.tNs - saved.samples[0]!.tNs) / 1e9;
  const context = { ...CONTEXT, captureFps, ...spans };
  return {
    analysis: analyzeReading(saved, context),
    liveCleanS: cleanSeconds(0, lastS, session.rejectedSpans),
    direct: analyzeReading(frames, context),
  };
}

function judged(timing: string, pulse: string, bpm: number) {
  const [, captureFps, offsetsS] = TIMINGS.find(([name]) => name === timing)!;
  const { analysis, liveCleanS } = replay(offsetsS, PULSES[pulse]!(bpm), captureFps);
  const outcome = readingOutcome(analysis);
  return { analysis, liveCleanS, urgent: outcome.urgent };
}

const RESTING_BPM = [50, 60, 70, 80, 90, 100, 110];
const FAST_BPM = [160, 170, 180, 190, 200];
const gridCases = (rates: number[]) =>
  TIMINGS.flatMap(([timing]) =>
    Object.keys(PULSES).flatMap((pulse) => rates.map((bpm) => [timing, pulse, bpm] as const)),
  );

// The fast grid cases option A still misses at a88af8a: the frame timing aliases the pulse below 150 bpm
// through its harmonics (round 7–10's mechanism), so the beats the rule reads are not the pulse's. Option
// B misses these and 387 more (only the floor-passing timings reach it there).
const MISSED_WITH_A = new Set(
  (
    [
      ['K even 120 ms + 2 copies', 'harmonics 0.5 / 0.25', [190, 200]],
      ['K even 120 ms + 2 copies', 'harmonics 0.8 / 0.4', [190, 200]],
      ['K even 110 ms + 2 copies', 'harmonics 0.8 / 0.4', [200]],
      ['K one 150 ms + 119 ms, 3 copies', 'harmonics 0.5 / 0.25', [190, 200]],
      ['K one 150 ms + 119 ms, 3 copies', 'harmonics 0.8 / 0.4', [180, 190, 200]],
      ['H 240 fps, 20-frame runs then every 36 steps', 'beatTrain, dicrotic 0.3', [180]],
      ['H 240 fps, 20-frame runs then every 36 steps', 'beatTrain, dicrotic 0.6 (strong)', [180]],
      ['H 240 fps, 20-frame runs then every 36 steps', 'harmonics 0.8 / 0.4', [160, 170, 180, 190]],
      ['H 240 fps, 18-frame runs then every 24 steps', 'harmonics 0.8 / 0.4', [170, 200]],
      ['I 12 times 20.834 ms apart + 2 copies, then ≤ 150 ms', 'harmonics 0.5 / 0.25', [180]],
      ['I 12 times 20.834 ms apart + 2 copies, then ≤ 150 ms', 'harmonics 0.8 / 0.4', [160, 180, 190, 200]],
      ['I 240 fps, 80-frame runs then every 36 steps', 'harmonics 0.5 / 0.25', [180]],
      ['I 240 fps, 80-frame runs then every 36 steps', 'harmonics 0.8 / 0.4', [170, 180, 190]],
      ['L four 120 ms in a row + 85 ms, 2 copies', 'harmonics 0.8 / 0.4', [200]],
      ['L four 119 ms in a row + 89 ms, 3 copies', 'harmonics 0.5 / 0.25', [200]],
      ['L four 119 ms in a row + 89 ms, 3 copies', 'harmonics 0.8 / 0.4', [190, 200]],
      ['M 120 ms × 4 + 12 ms × 6 + 80 ms × 5, 2 copies', 'harmonics 0.8 / 0.4', [200]],
      ['even 12 fps', 'harmonics 0.8 / 0.4', [200]],
    ] as [string, string, number[]][]
  ).flatMap(([timing, pulse, rates]) => rates.map((bpm) => `${timing}|${pulse}|${bpm}`)),
);
const fastCases = gridCases(FAST_BPM);
const isMissed = ([timing, pulse, bpm]: readonly [string, string, number]) =>
  MISSED_WITH_A.has(`${timing}|${pulse}|${bpm}`);

describe('red team a88af8a: the timings, at 75 bpm', () => {
  it.each(TIMINGS.map(([timing, , , cleanAtA88af8a]) => [timing, cleanAtA88af8a] as const))(
    '%s: about %p clean s of 95, live = saved',
    (timing, cleanAtA88af8a) => {
      const { analysis, liveCleanS } = judged(timing, 'beatTrain, dicrotic 0.3', 75);
      expect(analysis.cleanSeconds).toBeCloseTo(cleanAtA88af8a, 0);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    },
  );
});

describe('red team a88af8a option A: resting pulses under the floor raise no emergency trigger', () => {
  it.each(gridCases(RESTING_BPM))(
    '%s, %s, %i bpm, 95 s at rest: urgent null',
    (timing, pulse, bpm) => {
      expect(judged(timing, pulse, bpm).urgent).toBeNull();
    },
    SLOW_TEST_MS,
  );
});

describe('red team a88af8a option A: fast pulses under the floor reach fastSustained', () => {
  it.each(fastCases.filter((fast) => !isMissed(fast)))(
    '%s, %s, %i bpm, 95 s at rest: fastSustained',
    (timing, pulse, bpm) => {
      expect(judged(timing, pulse, bpm).urgent?.fastSustained).toBe(true);
    },
    SLOW_TEST_MS,
  );

  it.failing.each(fastCases.filter(isMissed))(
    'MISS (aliased): %s, %s, %i bpm, 95 s at rest: fastSustained',
    (timing, pulse, bpm) => {
      expect(judged(timing, pulse, bpm).urgent?.fastSustained).toBe(true);
    },
    SLOW_TEST_MS,
  );
});

describe('red team a88af8a finding A1: a burst timing doubles a strongly dicrotic resting pulse', () => {
  // H's 240 fps clock, 20-frame runs then a frame every 36 steps (≈ 7 distinct samples a second outside
  // the run), beatTrain with a dicrotic wave 0.8 of the beat at 90 bpm. The reading is refused (0 clean s),
  // but option A gives the rule the floor-rejected beats and they count the dicrotic wave as a beat:
  // fastSustained. The same pulse at 30 fps reads 90.0 bpm and raises nothing (control), and option B
  // raises nothing, so this false alarm is option A's own: the timing moves the edge of ADR 0066's known
  // doubling (at 30 fps dicrotic 0.85 at 90 bpm already reads 155.1 and 0.9 at 85–95 bpm fires). In the
  // probe neighbourhood (dicrotic 0.6–0.9 × 80–100 bpm, 42 replays) A fired 5 times: 0.8 and 0.85 at 90 bpm,
  // 0.9 at 80, 92 and 100 bpm; only 0.8 at 90 reads right at 30 fps.
  const burstTiming = clustered(TOTAL_S, 240, 240, 20, 36);
  it('control: dicrotic 0.8 at 90 bpm, 30 fps, reads 90 with urgent null', () => {
    const { analysis } = replay(evenFrames(30, TOTAL_S), dicroticTrain(90, 0.8), 30);
    expect(analysis.heartRateBpm).toBeCloseTo(90, 0);
    expect(readingOutcome(analysis).urgent).toBeNull();
  });
  it.failing(
    'H 240 fps, 20-frame runs then every 36 steps, beatTrain dicrotic 0.8, 90 bpm, 95 s at rest: urgent null',
    () => {
      const { analysis } = replay(burstTiming, dicroticTrain(90, 0.8), 240);
      expect(readingOutcome(analysis).urgent).toBeNull();
    },
  );
});

describe('red team a88af8a finding A2: sparse clusters alias a third harmonic above 150 bpm', () => {
  // Round 7's K timing (one sample time every 120 or 125 ms, 8.0–8.2 Hz, with 2 copies), a pulse whose
  // third harmonic equals its fundamental (second 0.3). At 108–112 bpm the third harmonic (5.4–5.6 Hz)
  // folds to 2.6–2.8 Hz, 160–170 bpm, and option A's rule reads it: fastSustained on a refused reading.
  // At 30 fps the pulse is refused with no trigger, and option B raises nothing. A waveform this
  // harmonic-heavy is adversarial, not a typical finger PPG; harmonics 0.3 / 0.6 raised nothing.
  it.failing.each([
    [118, 110],
    [118, 112],
    [123, 108],
  ])('K even %i ms + 2 copies, harmonics 0.3 / 1.0, %i bpm, 95 s at rest: urgent null', (gapMs, bpm) => {
    const { analysis } = replay(fromIntervals(TOTAL_S, [gapMs], 2), harmonicPulse(bpm, 0.3, 1.0), 30);
    expect(readingOutcome(analysis).urgent).toBeNull();
  });
  it('control: harmonics 0.3 / 1.0 at 110 bpm, 30 fps: urgent null', () => {
    const { analysis } = replay(evenFrames(30, TOTAL_S), harmonicPulse(110, 0.3, 1.0), 30);
    expect(readingOutcome(analysis).urgent).toBeNull();
  });
});

// 30 fps stretches of 1.9 s (under dsp7.minSegmentS, so DSP-7 finds no beats in them) split by 151 ms
// frame gaps, then one tailS stretch to 95 s: every accepted interval is in the tail.
function shortStretchesThenTail(tailS: number): number[] {
  const offsetsS: number[] = [];
  let fromS = 0;
  while (fromS < TOTAL_S - tailS) {
    for (let tS = fromS; tS < fromS + 1.9; tS += 1 / 30) offsetsS.push(toNsGrid(tS));
    fromS = offsetsS[offsetsS.length - 1]! + 0.151;
  }
  for (let tS = fromS; tS <= TOTAL_S; tS += 1 / 30) offsetsS.push(toNsGrid(tS));
  return offsetsS;
}

describe('red team a88af8a finding R1 (fixed): the emergency HR keeps ADR 0080 floor, so SQI-Net cannot raise slowBelow40', () => {
  // ADR 0080 (from #171) makes DSP-11's HR null unless its accepted intervals span 15 s. At a88af8a the
  // emergency view's HR checked only clean seconds: here the windows across the 151 ms gaps never form, so
  // with SQI-Net they are unscored and rejected (ADR 0057); the view drops them and keeps ≈ 88 clean s,
  // but the accepted intervals span only the tail (4–8 s). With sqi null the capture gave HR null and no
  // trigger; with SQI-Net (0.9 or 0.1) it gave slowBelow40 from 2–7 intervals, against ADR 0076 item 2
  // (SQI-Net may neither raise nor suppress the trigger). Fixed in 95f3992 (the view's HR keeps the 15 s
  // floor); these cases guard it. No false slowBelow40 was found on 45–80 bpm pulses with noise (400 replays).
  it.each([
    [8, 35, 0.9],
    [10, 35, 0.9],
    [13, 38, 0.9],
    [10, 35, 0.1],
  ])('%i s tail, %i bpm, SQI %f: urgent as with no SQI-Net (null)', (tailS, bpm, pClean) => {
    const offsetsS = shortStretchesThenTail(tailS);
    const withoutModel = replay(offsetsS, dicroticTrain(bpm, 0.3), 30, null);
    expect(withoutModel.analysis.heartRateBpm).toBeNull();
    expect(readingOutcome(withoutModel.analysis).urgent).toBeNull();
    const withModel = replay(offsetsS, dicroticTrain(bpm, 0.3), 30, pClean);
    expect(readingOutcome(withModel.analysis).urgent).toBeNull();
  });
});

describe('red team a88af8a: the rebase onto #171 kept the trigger (regression guards)', () => {
  const evenThirty = evenFrames(30, TOTAL_S);
  const urgentOf = (run: Replay): UrgentHeartRate | null => readingOutcome(run.analysis).urgent;

  // SQI-Net can neither raise nor suppress (ADR 0076 item 2): SQI 0.1 rejects every window, the outcome
  // is inconclusive, and urgent is what SQI 0.9 and no SQI-Net give.
  it.each([
    [170, { fastSustained: true, slowBelow40: false }],
    [72, null],
    [35, { fastSustained: false, slowBelow40: true }],
  ])('%i bpm at 30 fps: urgent the same with SQI 0.1, 0.9 and none', (bpm, expected) => {
    for (const pClean of [0.1, 0.9, null]) {
      const run = replay(evenThirty, dicroticTrain(bpm, 0.3), 30, pClean);
      expect(urgentOf(run)).toEqual(expected);
      expect(readingOutcome(run.analysis).kind).toBe(pClean === 0.1 ? 'inconclusive' : 'reading');
    }
  });

  // ADR 0080's lifted frames: lifts every 10–15 s leave the fast run bridged (each break under 6 s) and a
  // resting pulse untriggered, with SQI-Net clean or rejecting all.
  const liftedEvery = (everyS: number, liftS: number) => (tS: number) =>
    tS % everyS > 5 && tS % everyS < 5 + liftS;
  it.each([
    [170, 15, 0.5, 0.9, true],
    [170, 15, 2, 0.9, true],
    [170, 10, 0.5, 0.1, true],
    [75, 10, 0.5, 0.9, false],
    [75, 10, 0.5, 0.1, false],
    [75, 5, 0.5, 0.1, false],
    [140, 10, 0.5, 0.1, false],
    [45, 7, 0.3, 0.9, false],
  ])(
    '%i bpm, a finger lift every %i s for %p s, SQI %p: fastSustained %p, no slowBelow40',
    (bpm, everyS, liftS, pClean, fast) => {
      const run = replay(evenThirty, dicroticTrain(bpm, 0.3), 30, pClean, liftedEvery(everyS, liftS));
      expect(urgentOf(run)?.fastSustained ?? false).toBe(fast);
      expect(urgentOf(run)?.slowBelow40 ?? false).toBe(false);
    },
  );

  // Live and saved: the saved capture from readingInput gives the same urgent and clean seconds as the
  // whole capture analysed directly, under the floor and at 30 fps.
  it.each([
    ['even 20 fps', 170],
    ['even 20 fps', 72],
    ['H 240 fps, 20-frame runs then every 36 steps', 170],
    ['N pairs 16 ms + 89 ms apart, 1 copy', 170],
  ])('%s, %i bpm: saved = direct, live clean = saved clean', (timing, bpm) => {
    const [, captureFps, offsetsS] = TIMINGS.find(([name]) => name === timing)!;
    const run = replay(offsetsS, dicroticTrain(bpm, 0.3), captureFps);
    expect(urgentOf(run)).toEqual(emergencyHeartRate(run.direct));
    expect(run.liveCleanS).toBeCloseTo(run.analysis.cleanSeconds, 9);
  });

  it('the rest timer still gates fastSustained under the floor (even 20 fps, 170 bpm)', () => {
    const [, captureFps, offsetsS] = TIMINGS.find(([name]) => name === 'even 20 fps')!;
    const frames = capture(offsetsS, dicroticTrain(170, 0.3), () => false);
    const notRested = analyzeReading(frames, {
      ...CONTEXT,
      captureFps,
      restTimerDone: false,
    });
    expect(emergencyHeartRate(notRested)).toBeNull();
  });
});
