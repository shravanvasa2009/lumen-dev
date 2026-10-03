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

// Red team PR #171 round 5 (at 9f38758): every 1 s of a model window needs live.minSubWindowFps (16)
// distinct sample times, frames at least live.minSampleSpacingS apart, on top of the owner's 96 frames per
// 4 s window (ADR 0077, implementation note 3). Invariants: a capture accepted as a
// reading carries a heart rate within 5 bpm of its pulse (ANSI/AAMI EC13, as reading-outcome-edges), or it
// is refused; live and saved agree; ordinary phones finish each mode. SQI is a fixed 0.9 stand-in for the
// model; a still finger; batches of 3 frames, as reading-outcome-steps.

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

// Frame times in whole ns, fps from fromS through toS.
const framesS = (fromS: number, toS: number, fps: number): number[] =>
  Array.from(
    { length: Math.floor((toS - fromS) * fps + 1e-9) + 1 },
    (_, k) => Math.round(fromS * 1e9 + (k * 1e9) / fps) / 1e9,
  );

const steadyPulse = (bpm: number): Channels => beatTrain(beatTimes([60 / bpm], 400), 0.3);

// An 8-bit camera: every channel rounded to a 1/255 step.
const eightBit =
  (pulse: Channels): Channels =>
  (tS) => {
    const frame = pulse(tS);
    return {
      r: Math.round(frame.r * 255) / 255,
      g: Math.round(frame.g * 255) / 255,
      b: Math.round(frame.b * 255) / 255,
    };
  };

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

// Fewest frames in any closed span of spanS that starts on a frame, counting every frame as the 96-frame
// window count does.
function fewestFramesIn(offsetsS: number[], spanS: number): number {
  let fewest = Infinity;
  let end = 0;
  for (let i = 0; offsetsS[i]! + spanS <= offsetsS[offsetsS.length - 1]!; i++) {
    while (end < offsetsS.length && offsetsS[end]! <= offsetsS[i]! + spanS) end++;
    fewest = Math.min(fewest, end - i);
  }
  return fewest;
}

// A camera on a gridFps clock that keeps, in every periodSteps grid steps, a run of `run` consecutive frames
// and then one frame every everySteps steps until the period ends. Every gap stays within DSP-2's 150 ms
// limit, so nothing splits.
function clustered(totalS: number, gridFps: number, periodSteps: number, run: number, everySteps: number) {
  const steps: number[] = [];
  for (let base = 0; base / gridFps <= totalS; base += periodSteps) {
    for (let j = 0; j < run; j++) steps.push(base + j);
    for (let j = run - 1 + everySteps; j < periodSteps; j += everySteps) steps.push(base + j);
  }
  return steps.map((step) => Math.round((step * 1e9) / gridFps) / 1e9).filter((tS) => tS <= totalS);
}

describe('red team: clustered frames pass both frame counts but not the distinct-time count', () => {
  // 240 fps clock, 40 s, Quick. Each second holds 19 or 20 frames 4.2 ms apart and then
  // 6 frames about 150 ms apart: 100–104 frames per 4 s window and at least 25 in every 1 s, so both frame
  // counts pass. The beat signal is sampled at about 7 distinct times a second (a 3.5 Hz Nyquist rate), so
  // a 150–180 bpm pulse aliases: when every frame counted (9f38758) these read 85.5, 86.5, 38.6, 60.0 and
  // 100.5 bpm with 40.00 clean s. Each run counts as about 5 sample times, so each second holds about 12
  // and every window is rejected.
  it.each([
    ['20-frame runs, then every 36 steps', 240, 20, 36, 180, false],
    ['19-frame runs, then every 35 steps', 240, 19, 35, 180, false],
    ['19-frame runs, then every 36 steps', 240, 19, 36, 150, true],
    ['19-frame runs, then every 35 steps', 240, 19, 35, 150, true],
    ['9-frame runs per 0.5 s, then every 36 steps', 120, 9, 36, 150, true],
  ])('%s, %i-step period, %i/%i, %i bpm, 8-bit %p', (_, periodSteps, run, everySteps, bpm, quantized) => {
    const offsetsS = clustered(40, 240, periodSteps, run, everySteps);
    expect(fewestFramesIn(offsetsS, DSP_CONFIG.dsp3.modelWindowS)).toBeGreaterThanOrEqual(
      DSP_CONFIG.live.minEffectiveFps * DSP_CONFIG.dsp3.modelWindowS,
    );
    expect(fewestFramesIn(offsetsS, DSP_CONFIG.live.subWindowS)).toBeGreaterThanOrEqual(
      DSP_CONFIG.live.minSubWindowFps * DSP_CONFIG.live.subWindowS,
    );
    const pulse = quantized ? eightBit(steadyPulse(bpm)) : steadyPulse(bpm);
    const { analysis, liveCleanS } = replay(offsetsS, pulse, 240);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expect(analysis.cleanSeconds).toBe(0);
    expect(readingOutcome(analysis).kind).not.toBe('reading');
  });

  // The same pattern with frames every 24 steps (100 ms): about 13 distinct times a second, under 16, so
  // refused too, though it read within 1 bpm when every frame counted.
  it.each([75, 150, 200])('18-frame runs, then every 24 steps, %i bpm: refused', (bpm) => {
    const { analysis, liveCleanS } = replay(clustered(40, 240, 240, 18, 24), steadyPulse(bpm), 240);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expect(readingOutcome(analysis).kind).not.toBe('reading');
  });

  // Controls: every 16 steps (67 ms) or 12 steps (50 ms) gives about 17 or 22 distinct times a second, so
  // the 1 s count passes, and every rate tried reads within 1 bpm.
  it.each([
    [16, 75],
    [16, 150],
    [16, 200],
    [12, 75],
    [12, 150],
    [12, 200],
  ])('control: 18-frame runs, then every %i steps, %i bpm', (everySteps, bpm) => {
    const { analysis, liveCleanS } = replay(clustered(40, 240, 240, 18, everySteps), steadyPulse(bpm), 240);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - bpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
  });
});

// sparseS seconds at sparseFps, then denseS seconds at denseFps, repeated.
function alternating(totalS: number, sparseFps: number, denseFps: number, sparseS = 1, denseS = 1) {
  const offsetsS: number[] = [];
  for (let fromS = 0; fromS < totalS; fromS += sparseS + denseS) {
    offsetsS.push(...framesS(fromS, fromS + sparseS - 1e-6, sparseFps));
    offsetsS.push(...framesS(fromS + sparseS, fromS + sparseS + denseS - 1e-6, denseFps));
  }
  return offsetsS.filter((tS) => tS <= totalS);
}

describe('red team: sparse seconds of 16–23 fps between dense ones', () => {
  // Even sampling at 16 fps or more holds DSP-6's 8 Hz band, so these read right wherever both floors pass.
  it.each([
    [16, 32, 1, 1],
    [17, 31, 1, 1],
    [23, 25, 1, 1],
    [17, 31, 2, 2],
    [16, 60, 2, 1],
  ])('%i fps / %i fps in %i s / %i s, 42 and 200 bpm', (sparseFps, denseFps, sparseS, denseS) => {
    for (const bpm of [42, 200]) {
      const { analysis, liveCleanS } = replay(
        alternating(40, sparseFps, denseFps, sparseS, denseS),
        steadyPulse(bpm),
        30,
      );
      expect(readingOutcome(analysis).kind).toBe('reading');
      expect(Math.abs(analysis.heartRateBpm! - bpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    }
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
const randomDrops = (fps: number, totalS: number, dropsPerS: number, seed: number): number[] => {
  const uniform = uniformsFrom(seed);
  return framesS(0, totalS, fps).filter(() => uniform() >= dropsPerS / fps);
};

type Mode = keyof typeof DSP_CONFIG.rules.modeMinCleanS;

describe('red team: ordinary phones finish every mode', () => {
  // 75 bpm, stopping when the live counter shows the mode's target; maxDurationS is the capture length a
  // user would sit through. 1–4 random drops per s finish Quick in 30.0–34.1 s on six seeds; 5 per s (25 fps
  // on average, just above the owner's 96 frames per 4 s) takes 34.0–51.1 s, from the 96-frame floor, not
  // the 1 s rule. The same before and after the distinct-time count (implementation note 3).
  const throttled = (toS: number) => [...framesS(0, 10, 60), ...framesS(10 + 1 / 30, toS, 30)];
  const cases: [string, Mode, number, number, number[]][] = [
    ['30 fps, 1 random drop per s, seed 7919', 'quick', 30, 32, randomDrops(30, 80, 1, 7919)],
    ['30 fps, 3 random drops per s, seed 4 × 7919', 'quick', 30, 36, randomDrops(30, 80, 3, 4 * 7919)],
    ['30 fps, 5 random drops per s, seed 4 × 7919', 'quick', 30, 55, randomDrops(30, 80, 5, 4 * 7919)],
    ['30 fps, 5 random drops per s, seed 2 × 7919', 'full', 30, 135, randomDrops(30, 160, 5, 2 * 7919)],
    ['60 fps throttled to 30 fps at 10 s', 'quick', 60, 31, throttled(60)],
    ['60 fps throttled to 30 fps at 10 s', 'full', 60, 91, throttled(150)],
    ['60 fps throttled to 30 fps at 10 s', 'deep', 60, 301, throttled(330)],
    ['240 fps', 'quick', 240, 31, framesS(0, 50, 240)],
    ['240 fps', 'full', 240, 91, framesS(0, 120, 240)],
  ];
  it.each(cases)('%s, %s: a reading', (_, mode, fps, maxDurationS, offsetsS) => {
    const targetS = DSP_CONFIG.rules.modeMinCleanS[mode];
    const { analysis, liveCleanS } = replay(offsetsS, steadyPulse(75), fps, mode, targetS);
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(analysis.durationS).toBeLessThan(maxDurationS);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
  });
});
