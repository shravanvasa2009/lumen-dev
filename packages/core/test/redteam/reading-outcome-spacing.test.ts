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

// Red team PR #171 round 8 (at 412e982): ADR 0077 note 5 rejects a model window when 1 s of it holds
// live.maxSparseIntervalsPerS (5) frame intervals over live.sparseIntervalS (0.09 s), on top of note 4
// (two intervals over 0.12 s in 1 s), the 16-frame 1 s floor and 96 frames per 4 s. This round keeps
// every window at 4 sparse intervals per 1 s and checks the same invariants as round 7: an accepted reading
// is within 5 bpm of its pulse (ANSI/AAMI EC13) or the capture is refused; live and saved agree; ordinary
// phones finish each mode. SQI is a fixed 0.9 stand-in for the model; a still finger; batches of 3
// frames; no 8-bit rounding, so every error comes from frame timing.
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

const toNsGrid = (tS: number) => Math.round(tS * 1e9) / 1e9;

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
// note 4 measures them; 0 means that rule passes every window.
function longPairsWithin1s(offsetsS: number[]): number {
  const longIntervals: [number, number][] = [];
  for (let i = 1; i < offsetsS.length; i++)
    if (offsetsS[i]! - offsetsS[i - 1]! > DSP_CONFIG.live.maxFrameGapS + HALF_NS_S)
      longIntervals.push([offsetsS[i - 1]!, offsetsS[i]!]);
  return longIntervals.filter(
    ([, endS], k) => k > 0 && endS - longIntervals[k - 1]![0] <= DSP_CONFIG.live.subWindowS + HALF_NS_S,
  ).length;
}

// The most neighbouring-frame intervals over live.sparseIntervalS in one closed 1 s span, from the first
// one's start to the last one's end, as note 5 measures them.
function mostSparseIn1s(offsetsS: number[]): number {
  const startsS: number[] = [];
  let oldest = 0;
  let most = 0;
  for (let i = 1; i < offsetsS.length; i++) {
    if (offsetsS[i]! - offsetsS[i - 1]! <= DSP_CONFIG.live.sparseIntervalS + HALF_NS_S) continue;
    startsS.push(offsetsS[i - 1]!);
    while (offsetsS[i]! - startsS[oldest]! > DSP_CONFIG.live.subWindowS + HALF_NS_S) oldest++;
    most = Math.max(most, startsS.length - oldest);
  }
  return most;
}

function expectEveryFloorPasses(offsetsS: number[]): void {
  expect(fewestFramesIn(offsetsS, DSP_CONFIG.dsp3.modelWindowS)).toBeGreaterThanOrEqual(
    DSP_CONFIG.live.minEffectiveFps * DSP_CONFIG.dsp3.modelWindowS,
  );
  expect(fewestFramesIn(offsetsS, DSP_CONFIG.live.subWindowS)).toBeGreaterThanOrEqual(
    DSP_CONFIG.live.minSubWindowFps * DSP_CONFIG.live.subWindowS,
  );
  expect(longPairsWithin1s(offsetsS)).toBe(0);
  expect(mostSparseIn1s(offsetsS)).toBeLessThan(DSP_CONFIG.live.maxSparseIntervalsPerS);
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

// Per period: four intervals of longMs, then shortMs intervals until a fifth longMs interval starting
// next period would end more than 1 s after the first one starts, so every 1 s span holds at most 4
// intervals over 0.09 s. The fewest shortMs intervals that do so; copies adds each cluster's spread.
function fourLongInARow(longMs: number, shortMs: number, copies: number): number[] {
  let shorts = 0;
  while (4 * (longMs + copies) + shorts * (shortMs + copies) + longMs <= 1001) shorts++;
  return [longMs, longMs, longMs, longMs, ...Array<number>(shorts).fill(shortMs)];
}

// One interval of longMs, then shortMs intervals until five longMs intervals no longer fit in 1 s.
function fourLongSpread(longMs: number, shortMs: number, copies: number): number[] {
  let shorts = 0;
  while (4 * (longMs + copies + shorts * (shortMs + copies)) + longMs <= 1001) shorts++;
  return [longMs, ...Array<number>(shorts).fill(shortMs)];
}

describe('red team L: 4 intervals over 0.09 s per 1 s, a fast pulse aliases through its harmonics', () => {
  // 40 s, Quick. Every floor passes, including note 5 (checked first). At 412e982 every second counts
  // clean, live = saved, and these read (true bpm → read): four 120 ms in a row + 85 ms, 2 copies, 220 →
  // 112.5; + 80 ms 220 → 111.6; four 115 ms + 90 ms 220 → 111.2; four 120 ms + 89 ms 210 → 202.8;
  // spread 120 ms + 89 ms 220 → 208.6. 3 copies: four 119 ms + 80 ms 220 → 111.4; four 120 ms + 90 ms
  // 220 → 211.3. With a third harmonic of 0.25: four 119 ms + 89 ms, 3 copies, 210 → 183.7; spread
  // 119 ms + 90 ms, 2 copies, 220 → 110.8; four 120 ms + 89 ms, 3 copies, 200 → 175.6. Searched over
  // 95–120 ms long and 80–90 ms short intervals with 1–3 copies (1 copy never passes the floors), no
  // pattern misread the 0.3 second harmonic or beatTrain at 150–220 bpm.
  it.each([
    ['in a row', 120, 85, 2, 220, 0.5, 0],
    ['in a row', 120, 80, 2, 220, 0.5, 0],
    ['in a row', 115, 90, 2, 220, 0.5, 0],
    ['in a row', 120, 89, 2, 210, 0.5, 0],
    ['spread', 120, 89, 2, 220, 0.5, 0],
    ['in a row', 119, 80, 3, 220, 0.5, 0],
    ['in a row', 120, 90, 3, 220, 0.5, 0],
    ['in a row', 119, 89, 3, 210, 0.5, 0.25],
    ['spread', 119, 90, 2, 220, 0.5, 0.25],
    ['in a row', 120, 89, 3, 200, 0.5, 0.25],
  ])(
    'four %s %i ms + %i ms, %i copies, %i bpm, harmonics %f / %f: right or refused',
    (arrangement, longMs, shortMs, copies, bpm, second, third) => {
      const pattern = arrangement === 'spread' ? fourLongSpread : fourLongInARow;
      const offsetsS = clusters(40, pattern(longMs, shortMs, copies), copies);
      expectEveryFloorPasses(offsetsS);
      const { analysis, liveCleanS } = replay(offsetsS, harmonicPulse(bpm, second, third), 30);
      expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
      expectAccurateOrRefused(analysis, bpm);
    },
  );

  // The fifth interval is what note 5 counts: five 120 ms in a row with 85 ms between is refused (1.02 s
  // stays clean at 412e982, at the capture's edges).
  it('five 120 ms in a row + 85 ms, 2 copies, 220 bpm: refused', () => {
    const offsetsS = clusters(40, [120, 120, 120, 120, 120, 85, 85, 85, 85], 2);
    const { analysis } = replay(offsetsS, harmonicPulse(220, 0.5), 30);
    expect(analysis.cleanSeconds).toBeLessThan(1.1);
  });

  // Round 8's controls were clumps too: about 11 distinct sample times a second, under ADR 0077 note 6's 15,
  // so note 6 refuses them whatever they would read. That is stricter than round 8, by design.
  it.each([
    ['even 90 ms, 2 copies', clusters(40, [90], 2)],
    ['even 89 ms, 3 copies', clusters(40, [89], 3)],
    ['four 120 ms in a row + 85 ms, 2 copies', clusters(40, fourLongInARow(120, 85, 2), 2)],
    ['four spread 119 ms + 89 ms, 3 copies', clusters(40, fourLongSpread(119, 89, 3), 3)],
  ])('former control: %s is refused (note 6)', (_, offsetsS) => {
    expectEveryFloorPasses(offsetsS);
    for (const bpm of [150, 220]) {
      const { analysis } = replay(offsetsS, harmonicPulse(bpm, 0.5), 30);
      expect(readingOutcome(analysis).kind).toBe('inconclusive');
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

describe('red team: ordinary 30 fps phones with fresh seeds', () => {
  // Seeds the committed suite does not use. 75 bpm, Quick, stopping when the live counter shows 30 s.
  // Bounds are the committed suite's: 36.2 s for 1–4 drops per s, 56.1 s for 5 (25 fps mean, at the
  // 96-frame floor).
  const cases: [string, number, number][] = [];
  for (const drops of [1, 2, 3, 4, 5])
    for (const seed of [39595, 47514, 55433, 63352])
      cases.push([`30 fps ±8 ms, ${drops} drops per s, seed ${seed}`, drops, seed]);

  it.each(cases)('%s: a reading in Quick', (_, drops, seed) => {
    const maxDurationS = drops < 5 ? 36.2 : 56.1;
    const { analysis, liveCleanS } = replay(
      jittered(30, maxDurationS + 30, 0.008, drops, seed),
      steadyPulse(75),
      30,
      'quick',
      DSP_CONFIG.rules.modeMinCleanS.quick,
    );
    expect(readingOutcome(analysis).kind).toBe('reading');
    expect(Math.abs(analysis.heartRateBpm! - 75)).toBeLessThanOrEqual(HR_TOLERANCE_BPM);
    expect(analysis.durationS).toBeLessThan(maxDurationS);
    expect(liveCleanS).toBeCloseTo(analysis.cleanSeconds, 9);
  });
});
