import {
  analyzeReading,
  buildReadingResult,
  DSP_CONFIG,
  logisticRhythmOutputs,
  type ReadingContext,
  type ReadingResult,
  type RhythmOutputs,
} from '../../src';
import seedEvidence from '../../../../docs/validation/evidence.json';
import ruleFixture from '../fixtures/rhythm-logistic.json';
import {
  captureAt,
  parkMillerUniforms,
  regularBeats,
  regularOffsets,
  withPrematureBeats,
} from '../synthetic';
import { beatTrain } from './attacks';
import cases from './fixtures/rhythm-rule-cases.json';

const ABSTAIN = DSP_CONFIG.rules.uncertainBelowTopProb;
const CLASSES = ['sinus', 'af', 'other'];
// Each language is held to half the §10.2 parity tolerance against the exact reference in
// ml/tests/redteam/rule_cases.py, so the two agree within 1e-9 of each other.
const REFERENCE_TOLERANCE = 5e-10;

interface RuleCase {
  name: string;
  featureCount: number;
  rule: Record<string, unknown>;
  features: number[][];
  expect: 'probs' | 'refuse' | 'finiteOrRefuse';
  probs?: number[][];
}

const entryFor = (rule: unknown, featureCount: number, tauAf = 0.5) => ({
  inputs: { features: [1, featureCount] },
  threshold: { af: tauAf },
  abstainBelow: ABSTAIN,
  rule,
});

const toyRule = (changes: Record<string, unknown> = {}) => ({
  method: ruleFixture.rule.method,
  features: ['first', 'third'],
  featureIndices: [0, 2],
  mean: [0, 0],
  scale: [1, 1],
  classes: ['sinus', 'af', 'other'],
  coefficients: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  intercepts: [0, 0, 0],
  ...changes,
});
// Logits [0, ln 2, ln 3] -> [1, 2, 3] / 6; features 1 and 3 are not read.
const HAND_WINDOW = [Math.log(2), 99, Math.log(3), -99];

// Probabilities that are all finite and sum to 1, or a refusal; never a NaN that reaches the card.
function expectFiniteOrRefused(score: () => RhythmOutputs) {
  let outputs: RhythmOutputs;
  try {
    outputs = score();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return;
  }
  for (const row of outputs.windowProbs) {
    expect(row.every(Number.isFinite)).toBe(true);
    expect(Math.abs(row[0] + row[1] + row[2] - 1)).toBeLessThan(1e-12);
  }
}

describe('red team: logistic rule on the shared adversarial cases (TS side of the parity check)', () => {
  const all = cases as RuleCase[];

  it('loads a __proto__ key from JSON as a plain own key, so the shared case really tests it', () => {
    const withProto = all.find((ruleCase) => ruleCase.name === 'a __proto__ key beside a complete rule')!;
    expect(Object.prototype.hasOwnProperty.call(withProto.rule, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(withProto.rule)).toBe(Object.prototype);
  });

  it.each(all.map((ruleCase) => [ruleCase.name, ruleCase] as const))('%s', (_, ruleCase) => {
    const score = () =>
      logisticRhythmOutputs(entryFor(ruleCase.rule, ruleCase.featureCount), ruleCase.features);
    if (ruleCase.expect === 'refuse') {
      expect(score).toThrow();
      return;
    }
    if (ruleCase.expect === 'finiteOrRefuse') {
      expectFiniteOrRefused(score);
      return;
    }
    const classes = ruleCase.rule.classes as string[];
    const { windowProbs } = score();
    expect(windowProbs).toHaveLength(ruleCase.probs!.length);
    ruleCase.probs!.forEach((expected, k) =>
      CLASSES.forEach((name, c) =>
        expect(Math.abs(windowProbs[k]![c]! - expected[classes.indexOf(name)]!)).toBeLessThanOrEqual(
          REFERENCE_TOLERANCE,
        ),
      ),
    );
  });
});

describe('red team: logistic rule inputs JSON cannot carry', () => {
  // ADR 0024 makes every DSP-15 feature finite and Rhythm-Net reads all eight, so a non-finite value in a
  // column the rule ignores still means an upstream fault: refusing it is correct.
  it.each([Number.NaN, Infinity, -Infinity])('refuses %s in the unused 8th DSP-15 feature', (bad) => {
    const vector = [0, 0, 0, 0, 0, 0, 0, bad];
    expect(() => logisticRhythmOutputs(entryFor(ruleFixture.rule, 8), [vector])).toThrow(RangeError);
  });

  // Array.prototype.every skips holes, so a sparse vector passes the finite check.
  it('refuses a feature vector with a hole at a used index ([ , 99, ln 3, −99])', () => {
    const sparse = [...HAND_WINDOW];
    delete sparse[0];
    expect(() => logisticRhythmOutputs(entryFor(toyRule(), 4), [sparse])).toThrow(RangeError);
  });

  it('refuses a rule whose mean is new Array(2) (length right, no values)', () => {
    const rule = toyRule({ mean: new Array<number>(2) });
    expect(() => logisticRhythmOutputs(entryFor(rule, 4), [HAND_WINDOW])).toThrow(/mean/);
  });

  // The rule validates then reads again; a value that changes between the reads must not reach the output.
  it('uses the mean it validated when a Proxy returns 0 on the first read and NaN after', () => {
    let reads = 0;
    const mean = new Proxy([0, 0], {
      get: (target, key, receiver) =>
        key === '0' ? (reads++ === 0 ? 0 : Number.NaN) : Reflect.get(target, key, receiver),
    });
    expectFiniteOrRefused(() => logisticRhythmOutputs(entryFor(toyRule({ mean }), 4), [HAND_WINDOW]));
  });

  it('uses the feature it validated when a getter returns ln 2 on the first read and NaN after', () => {
    const vector = [...HAND_WINDOW];
    let reads = 0;
    Object.defineProperty(vector, 0, { get: () => (reads++ === 0 ? Math.log(2) : Number.NaN) });
    expectFiniteOrRefused(() => logisticRhythmOutputs(entryFor(toyRule(), 4), [vector]));
  });

  it('refuses an entry whose rule fields are only inherited from a JSON __proto__ key', () => {
    const entry = JSON.stringify(entryFor(null, 4));
    const parsed: unknown = JSON.parse(
      entry.replace('"rule":null', `"rule":{"__proto__":${JSON.stringify(toyRule())}}`),
    );
    expect(Object.keys((parsed as { rule: object }).rule)).toEqual(['__proto__']);
    expect(() => logisticRhythmOutputs(parsed, [HAND_WINDOW])).toThrow(/missing/);
  });
});

describe('red team: logistic rule window counts', () => {
  it('scores zero windows as no rows and one window as one row', () => {
    expect(logisticRhythmOutputs(entryFor(toyRule(), 4), []).windowProbs).toEqual([]);
    expect(logisticRhythmOutputs(entryFor(toyRule(), 4), [HAND_WINDOW]).windowProbs).toHaveLength(1);
  });

  // A reading has tens of windows; 10,000 only guards against accidental quadratic work.
  it('scores 10,000 DSP-15 windows with the fixture rule in under 500 ms', () => {
    const windows = Array.from(
      { length: 10_000 },
      (_, k) => ruleFixture.features[k % ruleFixture.features.length]!,
    );
    const start = performance.now();
    const { windowProbs } = logisticRhythmOutputs(entryFor(ruleFixture.rule, 8), windows);
    const elapsedMs = performance.now() - start;
    console.log(`logisticRhythmOutputs: 10,000 windows in ${elapsedMs.toFixed(1)} ms`);
    expect(windowProbs).toHaveLength(10_000);
    expect(elapsedMs).toBeLessThan(500);
  });
});

const CLOCK_START_NS = 5_000_000_000_000;
const SECONDS = 95;
const FPS = 60;
const CONTEXT: ReadingContext = {
  captureFps: FPS,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: { ms: Date.UTC(2026, 9, 4, 12), day: '2026-10-04' },
  motionSpans: [],
  coldHandsSpans: [],
  // One passing 4 s SQI window per second, so confidence can reach "high" and the abstain line is the
  // only thing that keeps a claim off the card.
  sqi: {
    threshold: 0.5,
    windows: Array.from({ length: SECONDS - 3 }, (_, k) => ({
      endNs: CLOCK_START_NS + (k + 4) * 1e9,
      pClean: 0.9,
    })),
  },
  validationRhythmLabel: null,
};
const PROFILE = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };

// AF-like: intervals uniform in 0.45–1.25 s (Park–Miller seed 12345).
function afBeatTimes(): number[] {
  const times = [1];
  for (const u of parkMillerUniforms(200)) {
    const next = times[times.length - 1]! + 0.45 + 0.8 * u;
    if (next > SECONDS - 1.5) break;
    times.push(next);
  }
  return times;
}

const RHYTHMS: [string, number[]][] = [
  ['sinus 64 bpm', regularBeats(1, SECONDS - 1.5, 64).map((beat) => beat.peakS)],
  ['AF-like 0.45–1.25 s intervals', afBeatTimes()],
  [
    'ectopy-heavy: every 4th beat premature at 0.6 × 0.9 s',
    withPrematureBeats(
      0.9,
      SECONDS,
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, 43, 47, 51, 55, 59, 63, 67, 71, 75, 79, 83, 87, 91, 95, 99],
      0.6,
    ).map((beat) => beat.peakS),
  ],
];
const ANALYSES = RHYTHMS.map(
  ([name, peaksS]) =>
    [name, analyzeReading(captureAt(regularOffsets(FPS, SECONDS), beatTrain(peaksS)), CONTEXT)] as const,
);

const resultOf = (analysis: (typeof ANALYSES)[number][1], rhythm: RhythmOutputs): ReadingResult =>
  buildReadingResult(analysis, { rhythm, diabetes: null }, seedEvidence, PROFILE, []);

function expectNoClaim(reading: ReadingResult) {
  expect(reading.headlineKey).not.toBe('result.regular');
  expect(reading.headlineKey).not.toBe('result.irregularRetake');
  expect(reading.headlineKey).not.toBe('result.possibleAf');
  if (reading.metrics.rhythm) {
    expect(reading.metrics.rhythm.confidence).toBe('low');
    expect(reading.metrics.rhythm.flag).toBeNull();
  }
}

describe('red team: synthetic readings through analyzeReading → logistic rule → buildReadingResult', () => {
  it.each(ANALYSES)(
    '%s: gives finite rows that sum to 1 and a reading that does not throw',
    (_, analysis) => {
      // The rhythm rules must actually be reached, or "no claim" would pass trivially.
      expect(analysis.rhythmWindows.length).toBeGreaterThan(0);
      expect(analysis.enoughRhythmIntervals).toBe(true);
      expect(analysis.cleanSeconds).toBeGreaterThanOrEqual(DSP_CONFIG.rules.rhythmMinCleanS);
      const rhythm = logisticRhythmOutputs(entryFor(ruleFixture.rule, 8), analysis.rhythmFeatures);
      expect(rhythm.windowProbs).toHaveLength(analysis.rhythmFeatures.length);
      for (const row of rhythm.windowProbs) {
        expect(row.every(Number.isFinite)).toBe(true);
        expect(Math.abs(row[0] + row[1] + row[2] - 1)).toBeLessThan(1e-12);
      }
      const reading = resultOf(analysis, rhythm);
      expect(reading.metrics.rhythm).not.toBeNull();
      if (rhythm.windowProbs.every((row) => Math.max(...row) < ABSTAIN)) expectNoClaim(reading);
      // "high" needs the reading-level top probability (the mean over windows) at or above highTopProb.
      const card = reading.metrics.rhythm;
      if (card?.confidence === 'high') {
        const column = CLASSES.indexOf(card.class);
        const meanTop =
          rhythm.windowProbs.reduce((total, row) => total + row[column]!, 0) / rhythm.windowProbs.length;
        expect(meanTop).toBeGreaterThanOrEqual(DSP_CONFIG.confidence.highTopProb);
      }
    },
  );

  // Intercepts ln 0.55, ln 0.25, ln 0.2 and zero weights: every window says sinus at 0.55, below the
  // abstain line; τ_AF 0 so the AF rule cannot be what stops a flag.
  it.each(ANALYSES)(
    '%s: makes no rhythm claim when every window abstains, even with τ_AF 0',
    (_, analysis) => {
      const rule = {
        ...ruleFixture.rule,
        coefficients: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        intercepts: [Math.log(0.55), Math.log(0.25), Math.log(0.2)],
      };
      const rhythm = logisticRhythmOutputs(entryFor(rule, 8, 0), analysis.rhythmFeatures);
      expect(rhythm.windowProbs.every((row) => Math.max(...row) < ABSTAIN)).toBe(true);
      expectNoClaim(resultOf(analysis, rhythm));
    },
  );

  // A finite manifest with one subnormal scale: z overflows to ±∞ on any feature off its mean.
  it.each(ANALYSES)(
    '%s: never shows a rhythm card with no class (fixture rule, scale [5e-324, …])',
    (_, analysis) => {
      const rule = { ...ruleFixture.rule, scale: [5e-324, ...ruleFixture.rule.scale.slice(1)] };
      let reading: ReadingResult;
      try {
        reading = resultOf(analysis, logisticRhythmOutputs(entryFor(rule, 8), analysis.rhythmFeatures));
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        return;
      }
      const card = reading.metrics.rhythm;
      if (card) {
        expect(CLASSES).toContain(card.class);
        expect(Number.isFinite(card.pAF)).toBe(true);
      }
    },
  );
});
