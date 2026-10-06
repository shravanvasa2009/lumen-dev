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

// Red team PR #171 round 6 (at 4b7d050): the 1 s check counted distinct sample times, frames at least
// 1/48 s after the last counted one, and needed live.minSubWindowFps (16) of them (ADR 0077, implementation
// note 3). Implementation note 4 replaces that with a maximum gap: a model window is rejected when two
// frames in a row are more than live.maxFrameGapS (0.12 s) apart; the 1 s check counts frames again.
// Invariants as reading-outcome-bursts: an accepted reading is within 5 bpm of its pulse (ANSI/AAMI EC13)
// or the capture is refused; live and saved agree; ordinary phones finish each mode. SQI is a fixed 0.9
// stand-in for the model; a still finger; batches of 3 frames; no 8-bit rounding, so every error below
// comes from frame timing alone.

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

const toNsGrid = (tS: number) => Math.round(tS * 1e9) / 1e9;

// Frame times in whole ns, fps from fromS through toS.
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

// Every second: `clump` frames spacingMs apart, each followed by `copies` frames 1 ms apart (they add to
// the 96-frame count only), then frames evenly spread at most 150 ms apart (DSP-2's gap limit) to the
// next second.
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

// A camera on a gridFps clock that keeps, in every periodSteps grid steps, a run of `run` consecutive frames
// and then one frame every everySteps steps until the period ends (as reading-outcome-bursts).
function clustered(totalS: number, gridFps: number, periodSteps: number, run: number, everySteps: number) {
  const steps: number[] = [];
  for (let base = 0; base / gridFps <= totalS; base += periodSteps) {
    for (let j = 0; j < run; j++) steps.push(base + j);
    for (let j = run - 1 + everySteps; j < periodSteps; j += everySteps) steps.push(base + j);
  }
  return steps.map((step) => toNsGrid(step / gridFps)).filter((tS) => tS <= totalS);
}

describe('red team: 16 distinct sample times clumped into a third of each second alias a fast pulse', () => {
  // 40 s, Quick. The distinct times of each second sit in a 0.2–0.33 s clump at 21–25 ms; the other
  // 0.67–0.8 s holds a frame every 132–150 ms, about 7 Hz, near the 7 Hz Nyquist rate of a 210 bpm
  // fundamental and under that of its harmonics. Both counts pass (checked first), every second counts clean, and at 4b7d050
  // these read 69.5, 99.3, 173.6, 69.9, 70.0 and 178.1 bpm. Even 16 and 20 fps (controls below) and 30 fps
  // with 3–5 random drops per s read these rates within 1 bpm: the clump, not the count, is at fault.
  // Under note 4 each second holds 4 or more intervals over 0.12 s, so all six give 0 clean s.
  it.each([
    ['12 times 20.834 ms apart + 2 copies each, then ≤ 150 ms', 240, 210, clumped(40, 12, 20.834, 2)],
    ['11 times 20.834 ms apart + 2 copies each, then ≤ 150 ms', 240, 210, clumped(40, 11, 20.834, 2)],
    ['11 times 20.834 ms apart + 2 copies each, then ≤ 150 ms', 240, 180, clumped(40, 11, 20.834, 2)],
    ['240 fps: 80-frame runs, then every 36 steps', 240, 210, clustered(40, 240, 240, 80, 36)],
    ['240 fps: 80-frame runs, then every 33 steps', 240, 210, clustered(40, 240, 240, 80, 33)],
    ['240 fps: 72-frame runs, then every 36 steps', 240, 210, clustered(40, 240, 240, 72, 36)],
  ])('%s, %i fps clock, %i bpm: right or refused', (_, fps, bpm, offsetsS) => {
    expect(fewestFramesIn(offsetsS, DSP_CONFIG.dsp3.modelWindowS)).toBeGreaterThanOrEqual(
      DSP_CONFIG.live.minEffectiveFps * DSP_CONFIG.dsp3.modelWindowS,
    );
    expect(fewestFramesIn(offsetsS, DSP_CONFIG.live.subWindowS)).toBeGreaterThanOrEqual(
      DSP_CONFIG.live.minSubWindowFps * DSP_CONFIG.live.subWindowS,
    );
    const { analysis, liveCleanS } = replay(offsetsS, steadyPulse(bpm), fps);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expectAccurateOrRefused(analysis, bpm);
  });

  const withCopies = (offsetsS: number[]) => offsetsS.flatMap((tS) => [tS, toNsGrid(tS + 0.001)]);
  it.each([
    ['16 fps, each frame + a copy 1 ms later', withCopies(framesS(0, 40, 16))],
    ['20 fps, each frame + a copy 1 ms later', withCopies(framesS(0, 40, 20))],
  ])('control: even %s reads 180 and 210 bpm', (_, offsetsS) => {
    for (const bpm of [180, 210]) {
      const { analysis, liveCleanS } = replay(offsetsS, steadyPulse(bpm), 30);
      expect(readingOutcome(analysis).kind).toBe('reading');
      expect(Math.abs(analysis.heartRateBpm! - bpm)).toBeLessThanOrEqual(1);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    }
  });
});

// Frames whose gaps alternate firstMs, secondMs, from 0 through totalS.
function alternatingGaps(totalS: number, firstMs: number, secondMs: number): number[] {
  const offsetsS: number[] = [];
  for (let tS = 0, k = 0; tS <= totalS; tS += (k++ % 2 === 0 ? firstMs : secondMs) / 1000)
    offsetsS.push(toNsGrid(tS));
  return offsetsS;
}

type Mode = keyof typeof DSP_CONFIG.rules.modeMinCleanS;

describe('red team: 30 fps with uneven frame pairs', () => {
  // 30 fps whose gaps alternate long and short. When the short gap is under 1/48 s, each pair counts as
  // one sample time, about 15 a second, so every window is refused: at 4b7d050, 0.98 clean s in 90 s of
  // Quick and 0 in 420 s of Deep, though the longest gap is 46–50 ms (DSP-6's 8 Hz band needs 62.5 ms).
  it.each([
    [45.9, 20.767],
    [46.5, 20.167],
    [50, 16.667],
  ])('gaps %f ms / %f ms, 75 bpm: Quick finishes in 31 s', (firstMs, secondMs) => {
    const targetS = DSP_CONFIG.rules.modeMinCleanS.quick;
    const offsetsS = alternatingGaps(90, firstMs, secondMs);
    const { analysis, liveCleanS } = replay(offsetsS, steadyPulse(75), 30, 'quick', targetS);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(analysis.durationS).toBeLessThan(31);
  });

  it.each([
    [45, 21.667],
    [45.5, 21.167],
    [45, 21],
    [40, 26.667],
  ])('control: gaps %f ms / %f ms, 75 bpm, Quick and Full', (firstMs, secondMs) => {
    for (const [mode, maxDurationS] of [
      ['quick', 31],
      ['full', 91],
    ] as [Mode, number][]) {
      const offsetsS = alternatingGaps(maxDurationS + 30, firstMs, secondMs);
      const targetS = DSP_CONFIG.rules.modeMinCleanS[mode];
      const { analysis, liveCleanS } = replay(offsetsS, steadyPulse(75), 30, mode, targetS);
      expect(readingOutcome(analysis).kind).toBe('reading');
      expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
      expect(analysis.durationS).toBeLessThan(maxDurationS);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    }
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

describe('red team: ordinary phones at 25, 60 and 120 fps finish every mode', () => {
  // 75 bpm, stopping when the live counter shows the mode's target. At 4b7d050 each finished within
  // 0.1 s of its target.
  const cases: [string, number, Mode, number, (totalS: number) => number[]][] = [
    ['25 fps', 25, 'quick', 31, (totalS) => framesS(0, totalS, 25)],
    ['25 fps', 25, 'deep', 301, (totalS) => framesS(0, totalS, 25)],
    ['25 fps, ±1 ms, 0.25 drops per s', 25, 'quick', 31, (totalS) => jittered(25, totalS, 0.001, 0.25, 7919)],
    ['25 fps, ±1 ms, 0.25 drops per s', 25, 'full', 91, (totalS) => jittered(25, totalS, 0.001, 0.25, 7919)],
    ['30 fps, ±8 ms, 2 drops per s', 30, 'full', 91, (totalS) => jittered(30, totalS, 0.008, 2, 7919)],
    ['60 fps, ±2 ms', 60, 'quick', 31, (totalS) => jittered(60, totalS, 0.002, 0, 7919)],
    ['60 fps, ±4 ms, 5 drops per s', 60, 'full', 91, (totalS) => jittered(60, totalS, 0.004, 5, 7919)],
    ['120 fps, ±1 ms', 120, 'deep', 301, (totalS) => jittered(120, totalS, 0.001, 0, 7919)],
    ['120 fps, ±2 ms, 10 drops per s', 120, 'quick', 31, (totalS) => jittered(120, totalS, 0.002, 10, 7919)],
  ];
  it.each(cases)('%s (%i fps), %s: a reading within %i s', (_, fps, mode, maxDurationS, offsetsFor) => {
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
