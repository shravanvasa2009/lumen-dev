import {
  analyzeReading,
  DSP_CONFIG,
  emergencyHeartRate,
  readingOutcome,
  type BeatInterval,
  type ReadingAnalysis,
  type ReadingContext,
  type RejectedSpan,
} from '../src';
import { captureAt, regularOffsets } from './synthetic';

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

// −R pulses at `bpm` on a covered fingertip (R/(G+B) ≈ 4, so every frame passes DSP-4).
function fingertip(bpm: number, seconds: number, fps = 30) {
  return captureAt(regularOffsets(fps, seconds), (tS) => {
    const phaseS = (tS + 0.5) % (60 / bpm);
    return { r: 0.62 - 0.004 * Math.exp(-0.5 * ((phaseS - 0.15) / 0.05) ** 2), g: 0.11, b: 0.04 };
  });
}

// A real analysis whose intervals, spans, and HR a test replaces; emergencyHeartRate reads only those,
// startNs, and the rest flag.
const BASE = analyzeReading(fingertip(72, 20), CONTEXT);

interface Stretch {
  bpm: number;
  count: number; // intervals, laid end to end
  accepted?: boolean;
}

// Intervals from 1 s on, each a whole ns as analyzeReading makes them (BeatInterval.tNs).
function intervalsOf(stretches: Stretch[]): BeatInterval[] {
  const intervals: BeatInterval[] = [];
  let atNs = BASE.startNs + 1e9;
  for (const { bpm, count, accepted = true } of stretches) {
    for (let k = 0; k < count; k++) {
      const tNs = atNs + Math.round(60e9 / bpm);
      intervals.push({ tNs, ibiMs: (tNs - atNs) / 1e6, accepted, nn: accepted });
      atNs = tNs;
    }
  }
  return intervals;
}

function analysisOf(
  intervals: BeatInterval[],
  rejectedSpans: RejectedSpan[] = [],
  heartRateBpm: number | null = 155,
  restTimerDone = true,
): ReadingAnalysis {
  return {
    ...BASE,
    context: { ...CONTEXT, restTimerDone },
    durationS: 200,
    rejectedSpans,
    intervals,
    heartRateBpm,
  };
}

const RULE = DSP_CONFIG.rules.emergency;

describe('emergencyHeartRate (§10.1 Emergency screen: HR > 150 sustained 60 s at rest; HR < 40)', () => {
  it('the thresholds are the spec §10.1 values', () => {
    expect(RULE.fastBpm).toBe(150);
    expect(RULE.sustainS).toBe(60);
    expect(RULE.slowBpm).toBe(40);
    // DSP-11's reporting floor; a break over 5 s restarts the count.
    expect(RULE.windowS).toBe(DSP_CONFIG.dsp11.minCleanS);
    expect(RULE.windowS - RULE.windowMinCleanS).toBe(5);
  });

  it('160 bpm for exactly 60.000 s (160 intervals of 375 ms) is urgent; 159 intervals (59.625 s) is not', () => {
    expect(emergencyHeartRate(analysisOf(intervalsOf([{ bpm: 160, count: 160 }])))).toEqual({
      fastSustained: true,
      slowBelow40: false,
    });
    expect(emergencyHeartRate(analysisOf(intervalsOf([{ bpm: 160, count: 159 }])))).toBeNull();
  });

  it('155 bpm for 61 s is urgent; for 59 s it is not', () => {
    const per = (seconds: number) => Math.round((seconds * 155) / 60);
    expect(emergencyHeartRate(analysisOf(intervalsOf([{ bpm: 155, count: per(61) }])))?.fastSustained).toBe(
      true,
    );
    expect(emergencyHeartRate(analysisOf(intervalsOf([{ bpm: 155, count: per(59) }])))).toBeNull();
  });

  it('exactly 150 bpm (400 ms intervals) for 120 s is not urgent: the spec says > 150', () => {
    expect(emergencyHeartRate(analysisOf(intervalsOf([{ bpm: 150, count: 300 }])))).toBeNull();
    // 399 ms is 150.4 bpm.
    expect(emergencyHeartRate(analysisOf(intervalsOf([{ bpm: 60000 / 399, count: 300 }])))).not.toBeNull();
  });

  it('not at rest (rest timer not done): HR > 150 is not an emergency by HR alone', () => {
    const intervals = intervalsOf([{ bpm: 170, count: 340 }]);
    expect(emergencyHeartRate(analysisOf(intervals, [], 170, false))).toBeNull();
  });

  it('a 3 s motion span is bridged but not counted; a 6 s break restarts the 60 s', () => {
    // 40 s, a 3 s motion span whose beats are artifacts, then 25 s: 65 clean s at 155 bpm.
    const bridged = intervalsOf([
      { bpm: 155, count: 103 },
      { bpm: 155, count: 8, accepted: false },
      { bpm: 155, count: 65 },
    ]);
    const motionStartS = (bridged[103]!.tNs - BASE.startNs) / 1e9 - 0.3;
    const motion = { startS: motionStartS, endS: motionStartS + 3, reason: 'motion' } as const;
    expect(emergencyHeartRate(analysisOf(bridged, [motion]))?.fastSustained).toBe(true);

    // The same 40 + 25 s with a 6 s break: neither side reaches 60 s.
    const split = intervalsOf([
      { bpm: 155, count: 103 },
      { bpm: 155, count: 16, accepted: false },
      { bpm: 155, count: 65 },
    ]);
    expect(emergencyHeartRate(analysisOf(split))).toBeNull();
  });

  it('bridged time does not count: 58 clean s around a 4 s break is not urgent', () => {
    const intervals = intervalsOf([
      { bpm: 155, count: 75 }, // 29 s
      { bpm: 155, count: 10, accepted: false }, // 3.9 s
      { bpm: 155, count: 75 },
    ]);
    expect(emergencyHeartRate(analysisOf(intervals))).toBeNull();
  });

  it('an accepted interval that overlaps a rejected span is not clean time', () => {
    const intervals = intervalsOf([{ bpm: 155, count: 180 }]); // 69.7 s
    const midS = (intervals[90]!.tNs - BASE.startNs) / 1e9;
    // 6 s of clipping with no beat marked artifact still splits the stretch into two < 60 s halves.
    const clipping = { startS: midS - 3, endS: midS + 3, reason: 'clipping' } as const;
    expect(emergencyHeartRate(analysisOf(intervals))).not.toBeNull();
    expect(emergencyHeartRate(analysisOf(intervals, [clipping]))).toBeNull();
  });

  it('a slower stretch inside 70 s at 155 breaks it when the 15 s median falls to 150 or below', () => {
    const intervals = intervalsOf([
      { bpm: 155, count: 90 }, // 34.8 s
      { bpm: 120, count: 20 }, // 10 s
      { bpm: 155, count: 90 },
    ]);
    expect(emergencyHeartRate(analysisOf(intervals))).toBeNull();
  });

  it('isolated premature beats (kept as atypical, DSP-9) do not break the rolling median', () => {
    const stretches: Stretch[] = [];
    for (let k = 0; k < 20; k++)
      stretches.push({ bpm: 155, count: 8 }, { bpm: 240, count: 1 }, { bpm: 110, count: 1 });
    expect(emergencyHeartRate(analysisOf(intervalsOf(stretches)))?.fastSustained).toBe(true);
  });

  it('reading HR < 40 bpm gives slowBelow40 (the app adds symptoms); 40 exactly does not', () => {
    expect(emergencyHeartRate(analysisOf([], [], 39.9))).toEqual({ fastSustained: false, slowBelow40: true });
    expect(emergencyHeartRate(analysisOf([], [], 40))).toBeNull();
    // Not gated on rest: the spec rule is "HR < 40 bpm with symptoms".
    expect(emergencyHeartRate(analysisOf([], [], 35, false))?.slowBelow40).toBe(true);
  });

  it('no beats and no HR: null', () => {
    expect(emergencyHeartRate(analysisOf([], [], null))).toBeNull();
    const silent = analyzeReading(
      captureAt(regularOffsets(30, 70), () => ({ r: 0.08, g: 0.08, b: 0.07 })),
      CONTEXT,
    );
    expect(emergencyHeartRate(silent)).toBeNull();
  });

  it('does not change its input and gives the same answer every call (pure)', () => {
    const analysis = analysisOf(intervalsOf([{ bpm: 160, count: 170 }]), [
      { startS: 100, endS: 101, reason: 'motion' },
    ]);
    const before = structuredClone(analysis);
    const first = emergencyHeartRate(analysis);
    expect(analysis).toEqual(before);
    expect(emergencyHeartRate(analysis)).toEqual(first);
    expect(emergencyHeartRate(structuredClone(analysis))).toEqual(first);
  });

  it('intervals listed out of time order give the same answer', () => {
    // 50 s fast, 10 s at 120 bpm, 50 s fast: neither fast side reaches 60 s.
    const intervals = intervalsOf([
      { bpm: 160, count: 133 },
      { bpm: 120, count: 20 },
      { bpm: 160, count: 133 },
    ]);
    expect(emergencyHeartRate(analysisOf(intervals))).toBeNull();
    expect(emergencyHeartRate(analysisOf([...intervals].reverse()))).toBeNull();
  });
});

describe('emergencyHeartRate on captures analyzeReading made', () => {
  it.each([30, 240])(
    '155 bpm for 70 s at %i fps on a Full Scan: inconclusive AND urgent',
    (fps) => {
      const analysis = analyzeReading(fingertip(155, 70, fps), { ...CONTEXT, captureFps: fps });
      expect(analysis.heartRateBpm).toBeCloseTo(155, 0);
      const outcome = readingOutcome(analysis);
      expect(outcome).toMatchObject({
        kind: 'inconclusive',
        reasons: ['tooFewCleanSeconds'],
        urgent: { fastSustained: true, slowBelow40: false },
      });
    },
    60_000,
  );

  it.each([30, 240])(
    '145 bpm for 70 s at %i fps: not urgent',
    (fps) => {
      const analysis = analyzeReading(fingertip(145, 70, fps), { ...CONTEXT, captureFps: fps });
      expect(readingOutcome(analysis)).toMatchObject({ kind: 'inconclusive', urgent: null });
    },
    60_000,
  );

  it('155 bpm for 95 s on a Full Scan: a reading AND urgent', () => {
    const analysis = analyzeReading(fingertip(155, 95), CONTEXT);
    expect(readingOutcome(analysis)).toEqual({
      kind: 'reading',
      urgent: { fastSustained: true, slowBelow40: false },
    });
  });

  it('155 bpm with a 3 s motion span at 40 s of 75 s: bridged, urgent; a 7 s span: not', () => {
    const capture = fingertip(155, 75);
    const span = (fromS: number, toS: number) => ({
      startNs: capture.samples[0]!.tNs + fromS * 1e9,
      endNs: capture.samples[0]!.tNs + toS * 1e9,
    });
    const bridged = analyzeReading(capture, { ...CONTEXT, motionSpans: [span(40, 43)] });
    expect(emergencyHeartRate(bridged)?.fastSustained).toBe(true);
    const split = analyzeReading(capture, { ...CONTEXT, motionSpans: [span(36, 43)] });
    expect(emergencyHeartRate(split)).toBeNull();
  });

  it('38 bpm for 60 s: slowBelow40', () => {
    const analysis = analyzeReading(fingertip(38, 60), CONTEXT);
    expect(analysis.heartRateBpm).toBeCloseTo(38, 0);
    expect(emergencyHeartRate(analysis)).toEqual({ fastSustained: false, slowBelow40: true });
  });

  it('72 bpm: not urgent on either outcome kind', () => {
    const analysis = analyzeReading(fingertip(72, 95), CONTEXT);
    expect(readingOutcome(analysis)).toEqual({ kind: 'reading', urgent: null });
  });
});
