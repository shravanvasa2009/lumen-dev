import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  type CaptureStatus,
  type FrameStat,
  type ReadingAnalysis,
  type ReadingContext,
  type Sample,
} from '../../src';
import { beatTimes, type Channels } from './attacks';

// Red team round 4 on PR #171 (Finding E, ADR 0081): one red step that DSP-4 calls covered used to raise
// DSP-7's segment-wide offset everywhere, so only the stronger beats of a modulated pulse were found and the
// rate read half. With the offset taken over a local window (dsp7.offsetWindowS) the step raises it only
// near the step. Invariant: a heart rate, when one is given, is within 5 bpm of the pulse (ANSI/AAMI EC13);
// none is a refusal. 30 fps, 40 s, Quick, a still finger, batches of 3 frames.

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
const STEP_AT_S = 20;

type Frame = { r: number; g: number; b: number };
type Gain = (k: number, beatS: number) => number;

// Frame times in whole ns, fps from fromS through toS.
const framesS = (fromS: number, toS: number, fps: number): number[] =>
  Array.from(
    { length: Math.floor((toS - fromS) * fps + 1e-9) + 1 },
    (_, k) => Math.round(fromS * 1e9 + (k * 1e9) / fps) / 1e9,
  );

const gaussian = (x: number, centre: number, width: number) => Math.exp(-0.5 * ((x - centre) / width) ** 2);

// beatTrain's beat shape with beat k scaled by gain(k, its time), on a red level of 0.9: a bright finger
// after DSP-5's lock, high enough that a 0.45 step stays above DSP-4's 0.30.
function scaledPulse(bpm: number, gain: Gain): Channels {
  const times = beatTimes([60 / bpm], 400);
  return (tS) => {
    let volume = 0;
    times.forEach((beatS, k) => {
      if (Math.abs(tS - beatS) < 1)
        volume += gain(k, beatS) * (gaussian(tS - beatS, 0.12, 0.07) + 0.3 * gaussian(tS - beatS, 0.4, 0.07));
    });
    return { r: 0.9 - 0.006 * volume, g: 0.1, b: 0.05 };
  };
}
// Respiratory amplitude modulation: depth m at a breathing period of periodS.
const breathing =
  (m: number, periodS: number): Gain =>
  (_k, beatS) =>
    1 + m * Math.sin((2 * Math.PI * beatS) / periodS);
// Pulsus alternans: strong and weak beats alternate.
const alternans =
  (m: number): Gain =>
  (k) =>
    k % 2 ? 1 - m : 1 + m;

// Red down by depth from 20 s for stepS seconds (Infinity: to the end), a partial lift or a pressure change.
const redStep =
  (depth: number, stepS: number) =>
  (tS: number, finger: Frame): Frame =>
    tS >= STEP_AT_S && tS < STEP_AT_S + stepS ? { ...finger, r: finger.r - depth } : finger;

function capture(
  pulse: Channels,
  scene: ((tS: number, finger: Frame) => Frame) | null = null,
): { samples: Sample[]; stats: FrameStat[] } {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const tS of framesS(0, 40, 30)) {
    const offsetNs = Math.round(tS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    const finger = pulse(offsetNs / 1e9);
    samples.push({ tNs, ...(scene ? scene(offsetNs / 1e9, finger) : finger) });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

// The app's loop: each new SQI-Net window scored pClean, then the saved analysis.
function replayLive(
  frames: { samples: Sample[]; stats: FrameStat[] },
  pClean: number,
): { analysis: ReadingAnalysis; liveCleanS: number } {
  const session = createLiveSession({
    captureFps: 30,
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
      session.setSqi(window.endS, pClean);
    }
  }
  const { capture: saved, ...spans } = session.readingInput();
  const lastS = (saved.samples[saved.samples.length - 1]!.tNs - saved.samples[0]!.tNs) / 1e9;
  return {
    analysis: analyzeReading(saved, { ...CONTEXT, ...spans }),
    liveCleanS: cleanSeconds(0, lastS, session.rejectedSpans),
  };
}

// Every step case reads its rate with the local offset (ADR 0081), so a refusal would hide a regression.
function expectAccurate(analysis: ReadingAnalysis, trueBpm: number): void {
  expect(analysis.heartRateBpm).not.toBeNull();
  expect(Math.abs(analysis.heartRateBpm! - trueBpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
}

describe('red team: one red step DSP-4 does not catch no longer halves the rate (ADR 0081)', () => {
  // Before the local offset (segment-wide β × mean) these read 25.0, 30.1, 37.5, 37.5, 30.0, 40.0, 62.7 bpm.
  it.each<[string, number, number, number, Gain]>([
    ['breathing ±30% / 3 s', 50, 0.33, 0.5, breathing(0.3, 3)],
    ['breathing ±50% / 3 s', 50, 0.3, 0.5, breathing(0.5, 3)],
    ['alternans ±30%', 75, 0.25, 0.5, alternans(0.3)],
    ['alternans ±30%', 75, 0.4, 0.5, alternans(0.3)],
    ['breathing ±30% / 3 s', 60, 0.45, Infinity, breathing(0.3, 3)],
    ['breathing ±50% / 3 s', 60, 0.33, Infinity, breathing(0.5, 3)],
    ['breathing ±50% / 3 s', 75, 0.45, Infinity, breathing(0.5, 3)],
  ])('%s at %i bpm, red down %p at 20 s for %p s: reads its rate', (_, bpm, depth, stepS, gain) => {
    const analysis = analyzeReading(capture(scaledPulse(bpm, gain), redStep(depth, stepS)), CONTEXT);
    expectAccurate(analysis, bpm);
  });

  // Before: 25.0 bpm, live = saved = 40.00 clean s.
  it('live, SQI 0.9: breathing ±30% / 3 s at 50 bpm, red down 0.33 for 0.5 s at 20 s: reads its rate', () => {
    const { analysis, liveCleanS } = replayLive(
      capture(scaledPulse(50, breathing(0.3, 3)), redStep(0.33, 0.5)),
      0.9,
    );
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
    expectAccurate(analysis, 50);
  });

  it.each<[string, number, Gain]>([
    ['breathing ±30% / 3 s', 50, breathing(0.3, 3)],
    ['breathing ±50% / 3 s', 60, breathing(0.5, 3)],
    ['alternans ±30%', 75, alternans(0.3)],
  ])('control: %s at %i bpm without a step reads its rate', (_, bpm, gain) => {
    const analysis = analyzeReading(capture(scaledPulse(bpm, gain)), CONTEXT);
    expect(analysis.heartRateBpm).not.toBeNull();
    expect(Math.abs(analysis.heartRateBpm! - bpm)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
  });
});
