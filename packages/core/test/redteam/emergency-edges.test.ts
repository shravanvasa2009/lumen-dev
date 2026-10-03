// Red team v1 for SAFE-1 (spec §10.1 Emergency screen, ADR 0076) at 6c49727: HR > 150 bpm sustained 60 s
// at rest, and HR < 40 bpm. Every signal goes through analyzeReading unless the test says "intervals".
// F1–F5 are the findings fixed after it.
import {
  analyzeReading,
  emergencyHeartRate,
  readingOutcome,
  type BeatInterval,
  type NsSpan,
  type ReadingAnalysis,
  type ReadingContext,
} from '../../src';
import { captureAt, jitteredOffsets, regularOffsets, type SyntheticCapture } from '../synthetic';
import { beatTimes, beatTrain, seededNormal, type Channels } from './attacks';

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

const SLOW_TEST_MS = 120_000;

function regular(bpm: number, seconds: number, dicroticRatio = 0.3, amplitude = 0.006): Channels {
  return beatTrain(beatTimes([60 / bpm], seconds), dicroticRatio, amplitude);
}

function analyze(
  channels: Channels,
  seconds: number,
  context: Partial<ReadingContext> = {},
  offsets?: number[],
): ReadingAnalysis {
  const fps = context.captureFps ?? 30;
  return analyzeReading(captureAt(offsets ?? regularOffsets(fps, seconds), channels), {
    ...CONTEXT,
    ...context,
  });
}

// Spans given in seconds from the first frame, as the app passes them in device-clock ns.
function nsSpans(capture: SyntheticCapture, secondsPairs: [number, number][]): NsSpan[] {
  const firstNs = capture.samples[0]!.tNs;
  return secondsPairs.map(([fromS, toS]) => ({ startNs: firstNs + fromS * 1e9, endNs: firstNs + toS * 1e9 }));
}

// A real analysis whose intervals a test replaces; emergencyHeartRate reads intervals, rejectedSpans,
// startNs, heartRateBpm, and the rest flag.
const BASE = analyze(regular(72, 20), 20);

// Intervals laid end to end from 1 s, cycling through intervalsMs, until totalS.
function cyclingIntervals(intervalsMs: number[], totalS: number): BeatInterval[] {
  const intervals: BeatInterval[] = [];
  let atNs = BASE.startNs + 1e9;
  for (let k = 0; atNs < BASE.startNs + (1 + totalS) * 1e9; k++) {
    const ibiMs = intervalsMs[k % intervalsMs.length]!;
    atNs += ibiMs * 1e6;
    intervals.push({ tNs: atNs, ibiMs, accepted: true, nn: true });
  }
  return intervals;
}

function withIntervals(intervals: BeatInterval[], heartRateBpm: number | null = 155): ReadingAnalysis {
  return { ...BASE, durationS: 300, rejectedSpans: [], intervals, heartRateBpm };
}

describe('red team SAFE-1: sustained fast rates that must reach the emergency screen', () => {
  it.each([
    [155, 30],
    [185, 30],
    [200, 30],
    [220, 30],
    [238, 30],
    [155, 240],
    [200, 240],
    [238, 240],
  ])(
    '%i bpm regular for 75 s at %i fps: inconclusive (Full Scan) and fastSustained',
    (bpm, fps) => {
      const analysis = analyze(regular(bpm, 75), 75, { captureFps: fps });
      expect(analysis.heartRateBpm).toBeCloseTo(bpm, 0);
      expect(readingOutcome(analysis)).toMatchObject({
        kind: 'inconclusive',
        urgent: { fastSustained: true },
      });
    },
    SLOW_TEST_MS,
  );

  it.each([0.0015, 0.0006, 0.0003])(
    'cold hands: 170 bpm at pulse amplitude %f of a 0.6 red level, 75 s: fastSustained',
    (amplitude) => {
      expect(emergencyHeartRate(analyze(regular(170, 75, 0.3, amplitude), 75))?.fastSustained).toBe(true);
    },
  );

  it('170 bpm with Gaussian red noise SD 0.0015 (seed 7, a quarter of the pulse), 75 s: fastSustained', () => {
    const pulse = regular(170, 75);
    const noise = seededNormal(7);
    const noisy: Channels = (tS) => {
      const frame = pulse(tS);
      return { ...frame, r: frame.r + 0.0015 * noise() };
    };
    expect(emergencyHeartRate(analyze(noisy, 75))?.fastSustained).toBe(true);
  });

  it('170 bpm at 30 fps with ±8 ms frame-time jitter, 75 s: fastSustained', () => {
    const analysis = analyze(regular(170, 75), 75, {}, jitteredOffsets(30, 75, 0.008));
    expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
  });

  it('170 bpm at 30 fps with every 3rd frame dropped (66.7 ms gaps, under the 150 ms DSP-2 limit), 90 s', () => {
    const offsets = regularOffsets(30, 90).filter((_, k) => k % 3 !== 1);
    expect(emergencyHeartRate(analyze(regular(170, 90), 90, {}, offsets))?.fastSustained).toBe(true);
  });

  it.each([3, 4])(
    '170 bpm for 120 s with a 200 ms frame gap every %i s (segments split there): fastSustained',
    (everyS) => {
      const offsets = regularOffsets(30, 120).filter((tS) => !(tS % everyS > 1.0 && tS % everyS < 1.2));
      expect(emergencyHeartRate(analyze(regular(170, 120), 120, {}, offsets))?.fastSustained).toBe(true);
    },
  );

  it('gradual onset: 110 bpm to 10 s, a linear ramp to 175 bpm at 40 s, then 175 bpm to 95 s', () => {
    const times: number[] = [];
    for (let tS = -2; tS < 97; tS += 60 / (tS < 10 ? 110 : tS < 40 ? 110 + (65 * (tS - 10)) / 30 : 175))
      times.push(tS);
    expect(emergencyHeartRate(analyze(beatTrain(times), 95))?.fastSustained).toBe(true);
  });

  it.each([0.65, 0.7])(
    '160 bpm, a premature beat every 4th beat at coupling %f RR (atypical, kept), 75 s: fastSustained',
    (coupling) => {
      const rrS = 60 / 160;
      const train = beatTrain(beatTimes([rrS, rrS, coupling * rrS, (2 - coupling) * rrS], 75));
      expect(emergencyHeartRate(analyze(train, 75))?.fastSustained).toBe(true);
    },
  );

  it('160 bpm, a premature beat every 3rd beat at coupling 0.7 RR (trigeminy), 75 s: fastSustained', () => {
    const rrS = 60 / 160;
    const train = beatTrain(beatTimes([rrS, 0.7 * rrS, 1.3 * rrS], 75));
    expect(emergencyHeartRate(analyze(train, 75))?.fastSustained).toBe(true);
  });

  it.each([3, 4, 4.1])(
    '170 bpm for 200 s with a %f s motion span every 20 s: bridged, fastSustained',
    (lengthS) => {
      const capture = captureAt(regularOffsets(30, 200), regular(170, 200));
      const motion = nsSpans(
        capture,
        Array.from({ length: 9 }, (_, k): [number, number] => [20 * k + 15, 20 * k + 15 + lengthS]),
      );
      const analysis = analyzeReading(capture, { ...CONTEXT, motionSpans: motion });
      expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
    },
    SLOW_TEST_MS,
  );

  it('170 bpm for 200 s, one SQI-Net 4 s window rejected every 25 s: still fastSustained', () => {
    const capture = captureAt(regularOffsets(30, 200), regular(170, 200));
    const firstNs = capture.samples[0]!.tNs;
    const windows = Array.from({ length: 7 }, (_, k) => ({
      endNs: firstNs + (25 * k + 20) * 1e9,
      pClean: 0.1,
    }));
    const analysis = analyzeReading(capture, { ...CONTEXT, sqi: { threshold: 0.5, windows } });
    expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
  });

  it('rest timer done is the only context gate: 170 bpm for 95 s is fastSustained with no SQI run', () => {
    expect(emergencyHeartRate(analyze(regular(170, 95), 95))?.fastSustained).toBe(true);
  });
});

describe('red team SAFE-1: signals that must not raise fastSustained', () => {
  it('148 bpm regular for 95 s: null', () => {
    expect(emergencyHeartRate(analyze(regular(148, 95), 95))).toBeNull();
  });

  it('170 bpm for 95 s with the rest timer not done: null (spec "at rest")', () => {
    expect(emergencyHeartRate(analyze(regular(170, 95), 95, { restTimerDone: false }))).toBeNull();
  });

  it('dicrotic ratio 0.8 at 75 bpm (double detection, ADR 0066): HR 150 shown, but not urgent', () => {
    // Every beat counted twice reads exactly 150 bpm, which is not > 150. At 78 or 80 bpm the same double
    // count reads 156–160 and is urgent: an upstream DSP-7/DSP-9 limit (ADR 0066), not this rule's.
    const analysis = analyze(regular(75, 95, 0.8), 95);
    expect(analysis.heartRateBpm!).toBeGreaterThan(150);
    expect(emergencyHeartRate(analysis)).toBeNull();
  });

  it('ambient flicker aliased to 2.6 Hz at amplitude 0.002 on a 75 bpm finger: null', () => {
    const pulse = regular(75, 95);
    const flicker: Channels = (tS) => {
      const frame = pulse(tS);
      return { ...frame, r: frame.r + 0.002 * Math.sin(2 * Math.PI * 2.6 * tS) };
    };
    expect(emergencyHeartRate(analyze(flicker, 95))).toBeNull();
  });
});

describe('red team SAFE-1: slowBelow40', () => {
  it.each([38, 35, 32, 30, 25])('%i bpm regular for 95 s: slowBelow40', (bpm) => {
    const analysis = analyze(regular(bpm, 95), 95);
    expect(analysis.heartRateBpm).toBeCloseTo(bpm, 0);
    expect(emergencyHeartRate(analysis)).toEqual({ fastSustained: false, slowBelow40: true });
  });

  it('60 bpm with a 3 s pause after every 7 beats, 95 s: HR 60, not slowBelow40', () => {
    const analysis = analyze(beatTrain(beatTimes([1, 1, 1, 1, 1, 1, 1, 3], 95)), 95);
    expect(analysis.heartRateBpm).toBeCloseTo(60, 0);
    expect(emergencyHeartRate(analysis)).toBeNull();
  });

  it.each([0.5, 0.3, 0.15])(
    '60 bpm where every other beat has %f × the amplitude, 95 s: HR 60, not slowBelow40',
    (ratio) => {
      expect(emergencyHeartRate(analyze(alternatingStrength(ratio), 95))).toBeNull();
    },
  );
});

// 60 bpm: strong beats every 2 s and beats of `ratio` × the amplitude 1 s after each.
function alternatingStrength(ratio: number): Channels {
  const strong = beatTrain(beatTimes([2], 95));
  const weak = beatTrain(
    beatTimes([2], 95).map((tS) => tS + 1),
    0.3,
    0.006 * ratio,
  );
  return (tS) => {
    const frame = strong(tS);
    return { ...frame, r: frame.r + weak(tS).r - 0.6 };
  };
}

describe('red team SAFE-1 findings F1–F5 in the rule, fixed', () => {
  // F1. A rolling median interval of a two-valued series is the long interval whenever a window holds an
  // odd count with one more long interval, and one such window ended the run. The rule now takes the
  // median two-beat span. 326.8/423.2 ms through the pipeline is a mean of 375 ms (160 bpm).
  it.each([30, 240])(
    'F1 alternating long/short beats 330/420 ms (160 bpm mean) for 75 s at %i fps: fastSustained',
    (fps) => {
      const analysis = analyze(beatTrain(beatTimes([0.33, 0.42], 75)), 75, { captureFps: fps });
      expect(analysis.heartRateBpm!).toBeGreaterThan(155);
      expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
    },
    SLOW_TEST_MS,
  );

  it.each([
    [340, 410],
    [360, 400],
  ])('F1 alternating %i/%i ms for 75 s at 30 fps (DSP-11 HR > 150): fastSustained', (shortMs, longMs) => {
    const analysis = analyze(beatTrain(beatTimes([shortMs / 1000, longMs / 1000], 75)), 75);
    expect(analysis.heartRateBpm!).toBeGreaterThan(150);
    expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
  });

  // Intervals only: 330/430 ms (760 ms pairs, so 15 s windows hold 39 or 40 intervals), mean 380 ms = 157.9
  // bpm, 300 s.
  it('F1 intervals: alternating 330/430 ms for 300 s gives fastSustained', () => {
    expect(emergencyHeartRate(withIntervals(cyclingIntervals([330, 430], 300)))?.fastSustained).toBe(true);
  });

  // F2. ADR 0076 bridges a rejected span up to 5 s. The beat touching it on each side is lost too, so the
  // old 5 s of window slack restarted the count at a 4.2 s motion span at 170 bpm.
  it.each([4.2, 4.5])(
    'F2 170 bpm for 200 s with a %f s motion span every 20 s (under the 5 s bridge): fastSustained',
    (lengthS) => {
      const capture = captureAt(regularOffsets(30, 200), regular(170, 200));
      const motion = nsSpans(
        capture,
        Array.from({ length: 9 }, (_, k): [number, number] => [20 * k + 15, 20 * k + 15 + lengthS]),
      );
      const analysis = analyzeReading(capture, { ...CONTEXT, motionSpans: motion });
      expect(analysis.heartRateBpm).toBeCloseTo(170, 0);
      expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
    },
    SLOW_TEST_MS,
  );

  // F3. Spec §10.1: the emergency screen "never depends on an AI output alone". Two adjacent 1 s SQI-Net
  // ticks rejected every 25 s (a 5 s quality span) removed the trigger that the same signal raises with
  // sqi null, so SQI-Net alone could veto it.
  it('F3 170 bpm for 200 s, two adjacent SQI-Net windows rejected every 25 s: fastSustained', () => {
    const capture = captureAt(regularOffsets(30, 200), regular(170, 200));
    const firstNs = capture.samples[0]!.tNs;
    const windows = Array.from({ length: 7 }, (_, k) => [
      { endNs: firstNs + (25 * k + 20) * 1e9, pClean: 0.1 },
      { endNs: firstNs + (25 * k + 21) * 1e9, pClean: 0.1 },
    ]).flat();
    expect(emergencyHeartRate(analyzeReading(capture, CONTEXT))?.fastSustained).toBe(true);
    const scored = analyzeReading(capture, { ...CONTEXT, sqi: { threshold: 0.5, windows } });
    expect(emergencyHeartRate(scored)?.fastSustained).toBe(true);
  });

  // F4. A true 150.000 bpm train (beat spacing 0.4 s) measures some 15 s windows a few µs under 400 ms,
  // and the strict "> 150" had no allowance for that, so exactly 150 bpm was flagged.
  it('F4 exactly 150 bpm regular for 95 s at 30 fps: not urgent (spec "> 150")', () => {
    expect(emergencyHeartRate(analyze(regular(150, 95), 95))).toBeNull();
  });

  // F5. Public API: a last clean interval longer than windowS emptied the window, and the loop then read
  // intervals[k + 1]. analyzeReading cannot make one (DSP-9 marks an interval over 2.5 s as artifact).
  it('F5 intervals: a single accepted 16 s interval returns null instead of throwing', () => {
    const intervals = [{ tNs: BASE.startNs + 20e9, ibiMs: 16_000, accepted: true, nn: true }];
    expect(emergencyHeartRate(withIntervals(intervals, null))).toBeNull();
  });
});
