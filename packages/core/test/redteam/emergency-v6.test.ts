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
import { beatTimes, beatTrain, seededNormal, type Channels } from './attacks';

// Red team PR #242 at 829c5c0 (SAFE-1, ADR 0076, option A): attacks on 95f3992's R1 fix (the emergency
// view's HR keeps ADR 0080's 15 s accepted-interval floor) and on `sparse && !flat`. The app's loop as in
// emergency-v5 (batches of 3 frames, a still finger, each new SQI-Net window scored pClean), Full Scan,
// rest timer done. ADR 0076 item 2: SQI-Net may neither raise nor suppress the trigger, so every case
// checks urgent is the same with SQI none, 0.9 and 0.1.

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
const SLOW_TEST_MS = 600_000;
const SQI_RUNS = [null, 0.9, 0.1] as const;
const TOTAL_S = 95;

const toNsGrid = (tS: number) => Math.round(tS * 1e9) / 1e9;
const evenFrames = (fps: number, totalS: number): number[] =>
  Array.from({ length: Math.floor(totalS * fps) + 1 }, (_, k) => toNsGrid(k / fps));

// 30 fps with a gapMs frame gap every everyS seconds: past DSP-2's 150 ms limit the segments split there.
function gapEvery(totalS: number, everyS: number, gapMs: number): number[] {
  return evenFrames(30, totalS).filter((tS) => tS % everyS < everyS - gapMs / 1000);
}

// 30 fps stretches of 1.9 s (no beats searched, windows across the 151 ms gaps never form: unscored
// with SQI-Net, ADR 0057) then one tailS stretch: every accepted interval is in the tail (R1's capture).
function shortStretchesThenTail(totalS: number, tailS: number): number[] {
  const offsetsS: number[] = [];
  let fromS = 0;
  while (fromS < totalS - tailS) {
    for (let tS = fromS; tS < fromS + 1.9; tS += 1 / 30) offsetsS.push(toNsGrid(tS));
    fromS = offsetsS[offsetsS.length - 1]! + 0.151;
  }
  for (let tS = fromS; tS <= totalS; tS += 1 / 30) offsetsS.push(toNsGrid(tS));
  return offsetsS;
}

// Tails of tailS seconds at 30 fps separated by runs of 1.9 s stretches lasting stretchS: the accepted
// intervals are split over several segments, each under 15 s, that add up past it.
function tailsSplitByStretches(totalS: number, tailS: number, stretchS: number): number[] {
  const offsetsS: number[] = [];
  let fromS = 0;
  while (fromS < totalS) {
    for (let tS = fromS; tS < Math.min(totalS, fromS + tailS); tS += 1 / 30) offsetsS.push(toNsGrid(tS));
    fromS = offsetsS[offsetsS.length - 1]! + 0.151;
    const stretchesEndS = fromS + stretchS;
    while (fromS < Math.min(totalS, stretchesEndS)) {
      for (let tS = fromS; tS < fromS + 1.9 && tS <= totalS; tS += 1 / 30) offsetsS.push(toNsGrid(tS));
      fromS = offsetsS[offsetsS.length - 1]! + 0.151;
    }
  }
  return offsetsS;
}

const dicroticTrain = (bpm: number, dicroticRatio: number, totalS: number, amplitude = 0.006): Channels =>
  beatTrain(beatTimes([60 / bpm], totalS + 5), dicroticRatio, amplitude);

function capture(
  offsetsS: number[],
  pulse: Channels,
  lifted: (tS: number) => boolean,
  noise: (() => number) | null,
): { samples: Sample[]; stats: FrameStat[] } {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const tS of offsetsS) {
    const offsetNs = Math.round(tS * 1e9);
    const tNs = CLOCK_START_NS + offsetNs;
    const frame = lifted(offsetNs / 1e9) ? { r: 0.05, g: 0.05, b: 0.05 } : pulse(offsetNs / 1e9);
    // Sensor noise in the red channel, so no window of a lifted-free capture is exactly flat.
    const r = noise ? frame.r + noise() : frame.r;
    samples.push({ tNs, ...frame, r });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

interface Replay {
  analysis: ReadingAnalysis;
  liveCleanS: number;
  direct: ReadingAnalysis;
}

interface Attack {
  offsetsS: number[];
  pulse: Channels;
  captureFps?: number;
  lifted?: (tS: number) => boolean;
  noiseSd?: number;
}

function replay(attack: Attack, pClean: number | null): Replay {
  const { offsetsS, pulse, captureFps = 30, lifted = () => false, noiseSd = 0 } = attack;
  const frames = capture(offsetsS, pulse, lifted, noiseSd > 0 ? scaled(seededNormal(4049), noiseSd) : null);
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

function scaled(normal: () => number, sd: number): () => number {
  return () => sd * normal();
}

const urgentOf = (run: Replay): UrgentHeartRate | null => readingOutcome(run.analysis).urgent;

// urgent for SQI none, 0.9 and 0.1, in that order.
const urgentBySqi = (attack: Attack) => SQI_RUNS.map((pClean) => urgentOf(replay(attack, pClean)));

const liftEvery = (everyS: number, liftS: number) => (tS: number) =>
  tS % everyS > 5 && tS % everyS < 5 + liftS;

describe('red team 829c5c0 (R1 fix): true slow pulses 30–39 bpm still raise slowBelow40, SQI-Net alike', () => {
  // A 95 s capture at 30 fps, segments split by lifts or frame gaps, and the 20 fps frame floor (option A
  // reads the floor-rejected beats). The 15 s span floor needs 8–10 intervals at these rates.
  const attacks: [string, (bpm: number) => Attack][] = [
    ['30 fps', (bpm) => ({ offsetsS: evenFrames(30, TOTAL_S), pulse: dicroticTrain(bpm, 0.3, TOTAL_S) })],
    [
      '30 fps, a 1 s lift every 10 s',
      (bpm) => ({
        offsetsS: evenFrames(30, TOTAL_S),
        pulse: dicroticTrain(bpm, 0.3, TOTAL_S),
        lifted: liftEvery(10, 1),
      }),
    ],
    [
      '30 fps, a 300 ms frame gap every 6 s',
      (bpm) => ({ offsetsS: gapEvery(TOTAL_S, 6, 300), pulse: dicroticTrain(bpm, 0.3, TOTAL_S) }),
    ],
    [
      'even 20 fps (frame floor)',
      (bpm) => ({ offsetsS: evenFrames(20, TOTAL_S), pulse: dicroticTrain(bpm, 0.3, TOTAL_S) }),
    ],
  ];
  const cases = attacks.flatMap(([name]) => [30, 33, 36, 39].map((bpm) => [name, bpm] as const));
  it.each(cases)(
    '%s, %i bpm, 95 s: slowBelow40 with SQI none, 0.9 and 0.1',
    (name, bpm) => {
      const attack = attacks.find(([label]) => label === name)![1](bpm);
      for (const urgent of urgentBySqi(attack)) expect(urgent?.slowBelow40).toBe(true);
    },
    SLOW_TEST_MS,
  );

  // 2:1 pulse deficit: a 70 bpm rhythm where every other beat ejects nothing the finger sees.
  it('pulse deficit, 70 bpm with every other beat silent (35 bpm pulse), 95 s: slowBelow40, SQI alike', () => {
    const attack = {
      offsetsS: evenFrames(30, TOTAL_S),
      pulse: beatTrain(beatTimes([60 / 35], TOTAL_S + 5), 0.3),
    };
    for (const urgent of urgentBySqi(attack)) expect(urgent?.slowBelow40).toBe(true);
  });
});

describe('red team 829c5c0 finding S1: sensor noise in a slow, weak pulse reads as a resting HR', () => {
  // A 33–39 bpm pulse at perfusion ≈ 0.5% (amplitude 0.003 of a 0.6 level) with white red-channel noise
  // (sd 0.0003–0.0006, 0.05–0.1% of the level; seeded normal 4049), 30 fps, 95 s, still, SQI any. DSP-7
  // (Elgendi) finds noise peaks in the long diastole, DSP-9 keeps them (atypical, accepted), and DSP-11 reads
  // 56–87 bpm: kind "reading", a wrong saved HR, and slowBelow40 missed. Not dicrotic (dicrotic 0 does it
  // too, so not ADR 0066) and the same with SQI none, 0.9 and 0.1 (not ADR 0076). Upstream of this PR: the
  // reading's HR is main's DSP-7/9/11, which #242 does not change; the trigger inherits it. Measured HR (sqi
  // null) in the names. At 45–72 bpm the same noise reads within 0.6 bpm, and amplitude 0.006 holds to
  // sd 0.0004 at 33 bpm and sd 0.0006 at 36–39 bpm. KNOWN-upstream (MAIN's ruling 2026-10-04): it.failing until
  // the DSP-7/9 slow-rate noise-beat fix.
  it.failing.each([
    [33, 0.3, 0.003, 0.0004, 64.5],
    [33, 0.3, 0.003, 0.0006, 74.6],
    [36, 0.3, 0.003, 0.0004, 56.4],
    [36, 0.3, 0.003, 0.0006, 72.7],
    [39, 0.3, 0.003, 0.0006, 70.1],
    [33, 0, 0.003, 0.0003, 64.6],
    [36, 0, 0.003, 0.0004, 64.1],
    [33, 0.3, 0.003, 0.0003, 58.3],
    [33, 0.3, 0.006, 0.0006, 58.3],
  ])(
    'MISS (noise beats): %i bpm, dicrotic %p, amplitude %p, noise sd %p (reads %p), 95 s: slowBelow40, SQI alike',
    (bpm, dicroticRatio, amplitude, noiseSd) => {
      const attack = {
        offsetsS: evenFrames(30, TOTAL_S),
        pulse: dicroticTrain(bpm, dicroticRatio, TOTAL_S, amplitude),
        noiseSd,
      };
      for (const urgent of urgentBySqi(attack)) expect(urgent?.slowBelow40).toBe(true);
    },
    SLOW_TEST_MS,
  );
  it.each([
    [36, 0.3, 0.003, 0.0003],
    [39, 0.3, 0.003, 0.0004],
    [36, 0.3, 0.006, 0.0006],
  ])(
    'control: %i bpm, dicrotic %p, amplitude %p, noise sd %p, 95 s: slowBelow40, SQI alike',
    (bpm, dicroticRatio, amplitude, noiseSd) => {
      const attack = {
        offsetsS: evenFrames(30, TOTAL_S),
        pulse: dicroticTrain(bpm, dicroticRatio, TOTAL_S, amplitude),
        noiseSd,
      };
      for (const urgent of urgentBySqi(attack)) expect(urgent?.slowBelow40).toBe(true);
    },
    SLOW_TEST_MS,
  );
});

describe('red team 829c5c0 (R1 fix): the span floor at its edge is the same with and without SQI-Net', () => {
  // R1's capture with tails around 15 s: the view's HR must give what heartRate gives with sqi null, so
  // urgent is the same for SQI none, 0.9 and 0.1 whichever side of the floor the tail falls.
  const cases = [12, 14, 15, 16, 17, 20].flatMap((tailS) => [35, 38].map((bpm) => [tailS, bpm] as const));
  it.each(cases)(
    '%i s tail after 1.9 s stretches, %i bpm: urgent the same with SQI none, 0.9 and 0.1',
    (tailS, bpm) => {
      const [none, clean, rejecting] = urgentBySqi({
        offsetsS: shortStretchesThenTail(TOTAL_S, tailS),
        pulse: dicroticTrain(bpm, 0.3, TOTAL_S),
      });
      expect(clean).toEqual(none);
      expect(rejecting).toEqual(none);
    },
    SLOW_TEST_MS,
  );

  // Tails under 15 s each, split by unscored stretches: the floor sums intervals over segments.
  it.each([
    [8, 6, 35],
    [10, 4, 35],
    [6, 8, 38],
    [9, 9, 32],
  ])(
    '%i s tails split by %i s of 1.9 s stretches, %i bpm: urgent the same with SQI none, 0.9 and 0.1',
    (tailS, stretchS, bpm) => {
      const [none, clean, rejecting] = urgentBySqi({
        offsetsS: tailsSplitByStretches(TOTAL_S, tailS, stretchS),
        pulse: dicroticTrain(bpm, 0.3, TOTAL_S),
      });
      expect(clean).toEqual(none);
      expect(rejecting).toEqual(none);
    },
    SLOW_TEST_MS,
  );
});

describe('red team 829c5c0: resting and fast pulses with premature beats and motion, SQI-Net alike', () => {
  // Bigeminy-like premature beats at 0.6 × the interval with a compensatory pause, a motion burst, and
  // a fast run: urgent must not depend on SQI-Net, and no resting rhythm raises slowBelow40.
  const premature = (bpm: number): Channels => {
    const sinusS = 60 / bpm;
    return beatTrain(beatTimes([sinusS, 0.6 * sinusS, 1.4 * sinusS], TOTAL_S + 5), 0.3);
  };
  const motionBurst = (bpm: number): Channels => {
    const pulse = dicroticTrain(bpm, 0.3, TOTAL_S);
    return (tS) => {
      const frame = pulse(tS);
      const shake = tS > 30 && tS < 34 ? 0.03 * Math.sin(2 * Math.PI * 2.7 * tS) : 0;
      return { ...frame, r: frame.r + shake };
    };
  };
  it.each([
    ['premature beats every 3rd', 45, premature(45), null],
    ['premature beats every 3rd', 60, premature(60), null],
    ['motion burst 30–34 s at 2.7 Hz', 42, motionBurst(42), null],
    ['motion burst 30–34 s at 2.7 Hz', 170, motionBurst(170), true],
  ] as const)(
    '%s, %i bpm, 95 s: urgent the same with SQI none, 0.9 and 0.1',
    (_name, _bpm, pulse, fast) => {
      const [none, clean, rejecting] = urgentBySqi({ offsetsS: evenFrames(30, TOTAL_S), pulse });
      expect(clean).toEqual(none);
      expect(rejecting).toEqual(none);
      expect(none?.slowBelow40 ?? false).toBe(false);
      if (fast !== null) expect(none?.fastSustained).toBe(fast);
    },
    SLOW_TEST_MS,
  );
});

describe('red team 829c5c0: `sparse && !flat`, flat stretches under the frame floor', () => {
  // A window both flat and under the floor stays rejected in the view (95f3992). A finger whose red holds
  // one value for a stretch (a stalled sensor) between 170 or 35 bpm runs, at an effective 20 fps: option
  // A's view must give what the same capture gives at 30 fps, where no window is under the floor.
  const flatBetween =
    (pulse: Channels, fromS: number, toS: number): Channels =>
    (tS) =>
      tS > fromS && tS < toS ? { r: 0.6, g: 0.1, b: 0.05 } : pulse(tS);
  it.each([
    [170, 40, 45],
    [170, 20, 28],
    [170, 30, 32],
    [35, 40, 45],
    [35, 20, 28],
  ])('%i bpm, red flat %i–%i s: urgent at 20 fps = at 30 fps, SQI alike', (bpm, fromS, toS) => {
    const pulse = flatBetween(dicroticTrain(bpm, 0.3, TOTAL_S), fromS, toS);
    const control = urgentOf(replay({ offsetsS: evenFrames(30, TOTAL_S), pulse }, null));
    for (const urgent of urgentBySqi({ offsetsS: evenFrames(20, TOTAL_S), pulse }))
      expect(urgent).toEqual(control);
  });
});

describe('red team 829c5c0: live and saved agree on urgent and clean seconds', () => {
  it.each([
    ['even 20 fps, 35 bpm', evenFrames(20, TOTAL_S), 35],
    ['16 s tail after 1.9 s stretches, 35 bpm', shortStretchesThenTail(TOTAL_S, 16), 35],
    ['30 fps, a 300 ms gap every 6 s, 36 bpm', gapEvery(TOTAL_S, 6, 300), 36],
  ] as const)('%s: saved urgent = direct, live clean = saved clean', (_name, offsetsS, bpm) => {
    for (const pClean of SQI_RUNS) {
      const run = replay({ offsetsS: [...offsetsS], pulse: dicroticTrain(bpm, 0.3, TOTAL_S) }, pClean);
      expect(urgentOf(run)).toEqual(emergencyHeartRate(run.direct));
      expect(run.liveCleanS).toBeCloseTo(run.analysis.cleanSeconds, 9);
    }
  });
});

describe('red team 829c5c0: urgent rides on inconclusive outcomes', () => {
  // A Quick-length capture refused under Full Scan's 90 s target still carries the trigger, and a
  // capture refused for no HR (20 fps) carries slowBelow40 from the view.
  it('60 s at 30 fps, 35 bpm, Full Scan: inconclusive (too few clean s) with slowBelow40', () => {
    const run = replay({ offsetsS: evenFrames(30, 60), pulse: dicroticTrain(35, 0.3, 60) }, null);
    const outcome = readingOutcome(run.analysis);
    expect(outcome.kind).toBe('inconclusive');
    expect(outcome.urgent?.slowBelow40).toBe(true);
  });
  it('95 s at even 20 fps, 35 bpm: inconclusive with slowBelow40, SQI alike', () => {
    for (const pClean of SQI_RUNS) {
      const run = replay({ offsetsS: evenFrames(20, 95), pulse: dicroticTrain(35, 0.3, 95) }, pClean);
      const outcome = readingOutcome(run.analysis);
      expect(outcome.kind).toBe('inconclusive');
      expect(outcome.urgent?.slowBelow40).toBe(true);
    }
  });
});
