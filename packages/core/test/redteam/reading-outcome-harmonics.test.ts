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

// Red team PR #171 round 7 (at fb92c45): a model window was rejected when any 1 s of it held two frame
// intervals over live.maxFrameGapS (0.12 s); one lone interval up to DSP-2's 0.15 s stays allowed; every
// 1 s span needs 16 frames and every 4 s window 96 (ADR 0077, implementation note 4). Case K got through
// those; note 5 also rejects a window when 1 s of it holds live.maxSparseIntervalsPerS (5) intervals over
// live.sparseIntervalS (0.09 s). Invariants as
// reading-outcome-clumps: an accepted reading is within 5 bpm of its pulse (ANSI/AAMI EC13) or the capture
// is refused; live and saved agree; ordinary phones finish each mode. SQI is a fixed 0.9 stand-in for the
// model; a still finger; batches of 3 frames; no 8-bit rounding, so every error comes from frame timing.

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
const P_CLEAN = 0.9;
const HALF_NS_S = 0.5e-9;

type Mode = keyof typeof DSP_CONFIG.rules.modeMinCleanS;

const toNsGrid = (tS: number) => Math.round(tS * 1e9) / 1e9;

const framesS = (fromS: number, toS: number, fps: number): number[] =>
  Array.from({ length: Math.floor((toS - fromS) * fps + 1e-9) + 1 }, (_, k) => toNsGrid(fromS + k / fps));

const steadyPulse = (bpm: number): Channels => beatTrain(beatTimes([60 / bpm], 400), 0.3);

function capture(offsetsS: number[], pulse: Channels): { samples: Sample[]; stats: FrameStat[] } {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const tS of offsetsS) {
    const offsetNs = Math.round(tS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    samples.push({ tNs, ...pulse(offsetNs / 1e9) });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

// The app's loop: each new SQI-Net window scored P_CLEAN, stopping once the live counter shows
// stopAtCleanS, then the saved analysis.
function replay(
  offsetsS: number[],
  pulse: Channels,
  captureFps: number,
  mode = 'quick',
  stopAtCleanS = Infinity,
): { analysis: ReadingAnalysis; liveCleanS: number } {
  const frames = capture(offsetsS, pulse);
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
    if (window && window.endS !== scoredEndS) {
      scoredEndS = window.endS;
      session.setSqi(window.endS, P_CLEAN);
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

function expectAccurateOrRefused(analysis: ReadingAnalysis, trueBpm: number): void {
  if (readingOutcome(analysis).kind !== 'reading') return;
  expect(Math.abs(analysis.heartRateBpm! - trueBpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
}

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

// Pairs of neighbouring-frame intervals over live.maxFrameGapS that fit together in a closed 1 s span, as
// note 4 measures them; 0 means that rule passes every window. Note 5 is left out: K is what it refuses.
function longPairsWithin1s(offsetsS: number[]): number {
  const longIntervals: [number, number][] = [];
  for (let i = 1; i < offsetsS.length; i++)
    if (offsetsS[i]! - offsetsS[i - 1]! > DSP_CONFIG.live.maxFrameGapS + HALF_NS_S)
      longIntervals.push([offsetsS[i - 1]!, offsetsS[i]!]);
  return longIntervals.filter(
    ([, endS], k) => k > 0 && endS - longIntervals[k - 1]![0] <= DSP_CONFIG.live.subWindowS + HALF_NS_S,
  ).length;
}

function expectEveryFloorPasses(offsetsS: number[]): void {
  expect(fewestFramesIn(offsetsS, DSP_CONFIG.dsp3.modelWindowS)).toBeGreaterThanOrEqual(
    DSP_CONFIG.live.minEffectiveFps * DSP_CONFIG.dsp3.modelWindowS,
  );
  expect(fewestFramesIn(offsetsS, DSP_CONFIG.live.subWindowS)).toBeGreaterThanOrEqual(
    DSP_CONFIG.live.minSubWindowFps * DSP_CONFIG.live.subWindowS,
  );
  expect(longPairsWithin1s(offsetsS)).toBe(0);
}

// Clusters of 1 + copies frames 1 ms apart (the copies add to the frame counts only). gapsMs, cycled, is
// each interval from a cluster's last frame to the next cluster's first: the interval note 4 measures.
function clusters(totalS: number, gapsMs: number[], copies: number): number[] {
  const offsetsS: number[] = [];
  for (let tS = 0, k = 0; tS <= totalS; k++) {
    for (let c = 0; c <= copies; c++) offsetsS.push(toNsGrid(tS + c / 1000));
    tS += (copies + gapsMs[k % gapsMs.length]!) / 1000;
  }
  return offsetsS.filter((tS) => tS <= totalS);
}

// One interval of longMs, then as many of shortMs as put the next long one's end more than 1 s after this
// one's start, so no closed 1 s span holds two: note 4's lone-interval allowance, used every period.
function oneLongPerSpan(longMs: number, shortMs: number): number[] {
  return [longMs, ...Array<number>(Math.floor((1000 - 2 * longMs) / shortMs) + 1).fill(shortMs)];
}

// Sinusoidal pulse with a second (and third) harmonic. A finger PPG's sharp upstroke puts real energy in
// its harmonics, which beatTrain's 70 ms Gaussians mostly smooth away (at 210 bpm its second harmonic is
// about 3% of the fundamental). DSP-6's morphology band, where DSP-7 finds beats, runs to 8 Hz.
function harmonicPulse(bpm: number, second: number, third = 0): Channels {
  const fundamentalHz = bpm / 60;
  return (tS) => {
    const phase = 2 * Math.PI * fundamentalHz * tS;
    const volume = Math.sin(phase) + second * Math.sin(2 * phase + 0.7) + third * Math.sin(3 * phase + 1.3);
    return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
  };
}

describe('red team K: every interval within 0.12 s, a fast pulse aliases through its second harmonic', () => {
  // 40 s, Quick. Sample times evenly spacingMs apart (8.3–10 Hz), each with 2 copies 1 ms later so both
  // frame floors pass, and no two intervals over 0.12 s share a 1 s span (all checked first). 0.12 s is
  // 1 / (2.2 × 3.67 Hz), set by the fundamental of 220 bpm alone; the second harmonic of 200–220 bpm
  // (6.7–7.3 Hz) aliases to 1.0–3.3 Hz, inside the HR band. At fb92c45 every second counts clean, live =
  // saved, and these read: 120 ms 210 → 104.7, 220 → 145.4; 110 ms 210 → 106.0, 220 → 109.9 (110.0 with
  // the harmonic at 0.3); 100 ms 220 → 214.5. Note 5 refuses each: about 1 clean s of 40.
  it.each([
    [120, 210, 0.5],
    [120, 220, 0.5],
    [110, 210, 0.5],
    [110, 220, 0.5],
    [110, 220, 0.3],
    [100, 220, 0.5],
  ])('even %i ms + 2 copies, %i bpm, second harmonic %f: right or refused', (spacingMs, bpm, second) => {
    const offsetsS = clusters(40, [spacingMs - 2], 2);
    expectEveryFloorPasses(offsetsS);
    const { analysis, liveCleanS } = replay(offsetsS, harmonicPulse(bpm, second), 30);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expectAccurateOrRefused(analysis, bpm);
  });

  // The lone-interval allowance on top: one 150 ms interval per period, then 110–120 ms intervals (3 copies
  // each) until the next long one ends just over 1 s after this one starts. At fb92c45: 150 + 119 ms reads
  // 200 → 100.8 and, with a third harmonic, 180 → 90.8; 150 + 120 ms 180 → 90.9; 150 + 115 ms 220 → 214.6;
  // 150 + 110 ms 210 → 105.4. 150 + 119 ms at 210 and 220 read 207.7 and 215.6 (within 5). Even 119 or
  // 120 ms with 3 copies and no 150 ms interval reads the 180 bpm pulse with harmonics 0.8 / 0.4 as 176.8–
  // 176.9, so the allowance widens K down to 180 bpm. Note 5 refuses each: under 1 clean s of 40.
  it.each([
    [119, 3, 200, 0.5, 0],
    [119, 3, 210, 0.5, 0],
    [119, 3, 220, 0.5, 0],
    [119, 3, 180, 0.8, 0.4],
    [120, 3, 180, 0.8, 0.4],
    [115, 3, 220, 0.5, 0],
    [110, 3, 210, 0.5, 0],
  ])(
    'one 150 ms + %i ms intervals, %i copies, %i bpm, harmonics %f / %f: right or refused',
    (shortMs, copies, bpm, second, third) => {
      const offsetsS = clusters(40, oneLongPerSpan(150, shortMs), copies);
      expectEveryFloorPasses(offsetsS);
      const { analysis, liveCleanS } = replay(offsetsS, harmonicPulse(bpm, second, third), 30);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
      expectAccurateOrRefused(analysis, bpm);
    },
  );

  // At fb92c45 the same frame patterns read beatTrain's weak harmonics within 1 bpm, so the harmonic, not
  // the frame count, was at fault. Note 5 judges frame times alone, so it refuses them whatever the pulse.
  it.each([
    ['even 120 ms + 2 copies', clusters(40, [118], 2)],
    ['one 150 ms + 119 ms, 3 copies', clusters(40, oneLongPerSpan(150, 119), 3)],
    ['one 150 ms + 110 ms, 3 copies', clusters(40, oneLongPerSpan(150, 110), 3)],
  ])('%s is refused with beatTrain at 180–220 bpm too', (_, offsetsS) => {
    for (const bpm of [180, 200, 210, 220]) {
      const { analysis } = replay(offsetsS, steadyPulse(bpm), 30);
      expect(readingOutcome(analysis).kind).not.toBe('reading');
    }
  });

  // 30 fps reads the harmonic pulses exactly, and even 62.5–90 ms + copies read them within 5 bpm (at
  // fb92c45 100 ms first failed, at 220 bpm). Every interval here is within live.sparseIntervalS.
  it.each([
    ['30 fps', framesS(0, 40, 30)],
    ['even 62.5 ms + 1 copy', clusters(40, [61.5], 1)],
  ])('control: %s reads 150–220 bpm with a second harmonic of 0.5', (_, offsetsS) => {
    for (const bpm of [150, 180, 200, 210, 220]) {
      const { analysis } = replay(offsetsS, harmonicPulse(bpm, 0.5), 30);
      expect(readingOutcome(analysis).kind).toBe('reading');
      expect(Math.abs(analysis.heartRateBpm! - bpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    }
  });

  // ADR 0077 note 6: 90 ms clumps hold about 11 distinct sample times a second, under the Nyquist rate of
  // 220 bpm's 2nd harmonic (15), so they are refused whatever they would read.
  it('even 90 ms + 2 copies is refused (note 6)', () => {
    const { analysis } = replay(clusters(40, [88], 2), harmonicPulse(220, 0.5), 30);
    expect(readingOutcome(analysis).kind).toBe('inconclusive');
  });
});

// Frames at most 1/30 s apart, except two long intervals per periodS: one starting 0.3 s into the period
// and one ending spanNs after that start, so spanNs is the shortest closed span holding both.
function twoLongIntervals(totalS: number, periodS: number, longS: number, spanNs: number): number[] {
  const offsetsS: number[] = [];
  const fillUpTo = (fromS: number, toS: number) => {
    const steps = Math.ceil((toS - fromS) * 30 - 1e-9);
    for (let k = 0; k < steps; k++) offsetsS.push(fromS + ((toS - fromS) * k) / steps);
  };
  for (let baseS = 0; baseS + periodS <= totalS + 1e-9; baseS += periodS) {
    const firstS = baseS + 0.3;
    const lastS = (Math.round(firstS * 1e9) + spanNs) / 1e9;
    fillUpTo(baseS, firstS);
    offsetsS.push(firstS);
    fillUpTo(firstS + longS, lastS - longS);
    offsetsS.push(lastS - longS);
    fillUpTo(lastS, baseS + periodS);
  }
  return offsetsS.map(toNsGrid).filter((tS, i, all) => i === 0 || tS > all[i - 1]!);
}

describe('red team: 1 s span edges of the two-long-intervals rule', () => {
  // The rule tests the closed extent from the first long interval's start to the second's end, with
  // DSP-2's half-ns allowance, so a pair 1 s + 1 ns apart fits no 1 s span and passes by design. 60 s,
  // 75 bpm. At fb92c45 each refused case keeps under 1 clean s, and each passing case 59.95 s or more.
  it.each([
    ['150 ms pair spanning exactly 1 s', 2, 0.15, 1e9, false],
    ['150 ms pair spanning 1 s − 1 ns', 2, 0.15, 1e9 - 1, false],
    ['121 ms pair spanning 0.5 s', 2, 0.121, 0.5e9, false],
    ['120.000001 ms pair spanning 0.5 s', 2, 0.120000001, 0.5e9, false],
    ['120 ms pair spanning 0.5 s (not long)', 2, 0.12, 0.5e9, true],
    ['150 ms pair spanning 1 s + 1 ns', 2, 0.15, 1e9 + 1, true],
    ['150 ms pairs spanning 1 s + 1 ns, every 1.2 s', 1.2, 0.15, 1e9 + 1, true],
  ])('%s', (_, periodS, longS, spanNs, clean) => {
    const offsetsS = twoLongIntervals(60, periodS, longS, spanNs);
    const { analysis, liveCleanS } = replay(offsetsS, steadyPulse(75), 30);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    if (clean) {
      expect(analysis.cleanSeconds).toBeGreaterThan(59.9);
      expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(1);
    } else expect(analysis.cleanSeconds).toBeLessThan(1);
  });

  it('frame intervals alternating 119 and 121 ms (3 copies each) are refused at 210 bpm', () => {
    const { analysis } = replay(clusters(40, [119, 121], 3), harmonicPulse(210, 0.5), 30);
    expect(analysis.cleanSeconds).toBeLessThan(1);
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

// Frames whose gaps alternate firstMs, secondMs, from 0 through totalS.
function alternatingGaps(totalS: number, firstMs: number, secondMs: number): number[] {
  const offsetsS: number[] = [];
  for (let tS = 0, k = 0; tS <= totalS; tS += (k++ % 2 === 0 ? firstMs : secondMs) / 1000)
    offsetsS.push(toNsGrid(tS));
  return offsetsS;
}

const MODE_BOUNDS: [Mode, number][] = [
  ['quick', 31.1],
  ['full', 91.1],
  ['deep', 301.1],
];

describe('red team: ordinary phones finish every mode', () => {
  // 75 bpm, stopping when the live counter shows the mode's target. Bounds are the fb92c45 measurements
  // plus 1 s: 30 fps ±8 ms with 1–4 random drops per s finished Quick in 30.0–35.2 s; 5 drops per s (25 fps
  // mean, at the 96-frame floor) took 39.1–55.1 s for Quick and 131.1–152.0 s for Full, as ADR 0077 note 4
  // reports; 25, 60 and 120 fps (±2 ms) and J's uneven pairs finished within 0.1 s of every target. The
  // longest replay, 120 fps Deep, took 4.8–10.6 s of wall time.
  const cases: [string, number, Mode, number, (totalS: number) => number[]][] = [];
  for (const drops of [1, 2, 3, 4])
    for (const seed of [7919, 15838, 23757, 31676])
      cases.push([
        `30 fps ±8 ms, ${drops} drops per s, seed ${seed}`,
        30,
        'quick',
        36.2,
        (totalS) => jittered(30, totalS, 0.008, drops, seed),
      ]);
  for (const seed of [7919, 15838, 23757, 31676])
    cases.push([
      `30 fps ±8 ms, 5 drops per s, seed ${seed}`,
      30,
      'quick',
      56.1,
      (totalS) => jittered(30, totalS, 0.008, 5, seed),
    ]);
  for (const seed of [7919, 15838])
    cases.push([
      `30 fps ±8 ms, 5 drops per s, seed ${seed}`,
      30,
      'full',
      153,
      (totalS) => jittered(30, totalS, 0.008, 5, seed),
    ]);
  cases.push([
    '30 fps ±8 ms, 3 drops per s',
    30,
    'deep',
    301.1,
    (totalS) => jittered(30, totalS, 0.008, 3, 7919),
  ]);
  for (const fps of [25, 60, 120])
    for (const [mode, maxDurationS] of MODE_BOUNDS)
      cases.push([
        `${fps} fps ±2 ms`,
        fps,
        mode,
        maxDurationS,
        (totalS) => jittered(fps, totalS, 0.002, 0, 7919),
      ]);
  for (const [firstMs, secondMs] of [
    [45.9, 20.767],
    [46.5, 20.167],
    [50, 16.667],
  ])
    for (const [mode, maxDurationS] of MODE_BOUNDS)
      cases.push([
        `30 fps, gaps ${firstMs} / ${secondMs} ms`,
        30,
        mode,
        maxDurationS,
        (totalS) => alternatingGaps(totalS, firstMs!, secondMs!),
      ]);

  it.each(cases)('%s (%i fps), %s: a reading within %f s', (_, fps, mode, maxDurationS, offsetsFor) => {
    const targetS = DSP_CONFIG.rules.modeMinCleanS[mode];
    const { analysis, liveCleanS } = replay(
      offsetsFor(maxDurationS + 30),
      steadyPulse(75),
      fps,
      mode,
      targetS,
    );
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(analysis.durationS).toBeLessThan(maxDurationS);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
  });
});
