import { DSP_CONFIG, logisticRhythmOutputs, RHYTHM_FEATURE_NAMES } from '../src';
import fixture from './fixtures/rhythm-logistic.json';

const ABSTAIN = DSP_CONFIG.rules.uncertainBelowTopProb;
const METHOD = fixture.rule.method;

// 2 of 4 features; zero mean and unit scale, so z is the raw feature, and the logits are easy by hand.
function toyRule(changes: Record<string, unknown> = {}) {
  return {
    method: METHOD,
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
  };
}

function toyEntry(changes: Record<string, unknown> = {}) {
  return {
    inputs: { features: [1, 4] },
    threshold: { af: 0.5 },
    abstainBelow: ABSTAIN,
    rule: toyRule(),
    ...changes,
  };
}

// Logits [0, ln 2, ln 3] -> [1, 2, 3] / 6; features 1 and 3 are not read.
const HAND_WINDOW = [Math.log(2), 99, Math.log(3), -99];
const HAND_PROBS = [1 / 6, 2 / 6, 3 / 6];

function expectClose(actual: readonly number[], expected: readonly number[], tolerance: number) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, k) => expect(Math.abs(value - expected[k]!)).toBeLessThanOrEqual(tolerance));
}

describe('logistic rhythm rule (§11.1 fallback)', () => {
  it('gives the softmax by hand for a toy rule', () => {
    const { windowProbs } = logisticRhythmOutputs(toyEntry(), [HAND_WINDOW]);
    expectClose(windowProbs[0]!, HAND_PROBS, 1e-15);
  });

  it('standardizes with mean and scale before the logits', () => {
    const entry = toyEntry({ rule: toyRule({ mean: [1, -2], scale: [2, 0.5] }) });
    const window = [1 + 2 * Math.log(2), 0, -2 + 0.5 * Math.log(3), 0];
    expectClose(logisticRhythmOutputs(entry, [window]).windowProbs[0]!, HAND_PROBS, 1e-15);
  });

  it('does not overflow on large logits', () => {
    const [probs] = logisticRhythmOutputs(toyEntry(), [[1000, 0, 999, 0]]).windowProbs;
    const e = Math.exp(-1);
    expectClose(probs!, [0, 1 / (1 + e), e / (1 + e)], 1e-15);
  });

  it('returns sinus, af, other whatever order the rule lists its classes in', () => {
    const rule = toyRule({
      classes: ['other', 'sinus', 'af'],
      coefficients: [
        [0, 1],
        [0, 0],
        [1, 0],
      ],
    });
    const { windowProbs } = logisticRhythmOutputs(toyEntry({ rule }), [HAND_WINDOW]);
    expectClose(windowProbs[0]!, HAND_PROBS, 1e-15);
  });

  it('carries the entry threshold.af as τ_AF and scores one row per window', () => {
    const outputs = logisticRhythmOutputs(toyEntry({ threshold: { af: 0.37 } }), [HAND_WINDOW, HAND_WINDOW]);
    expect(outputs.tauAf).toBe(0.37);
    expect(outputs.windowProbs).toHaveLength(2);
    expect(logisticRhythmOutputs(toyEntry(), []).windowProbs).toEqual([]);
  });

  it('matches the Python reference on the seeded fixture within 1e-9 (§10.2)', () => {
    const entry = {
      inputs: fixture.inputs,
      threshold: { af: 0.5 },
      abstainBelow: ABSTAIN,
      rule: fixture.rule,
    };
    const { windowProbs } = logisticRhythmOutputs(entry, fixture.features);
    const order = ['sinus', 'af', 'other'].map((name) => fixture.rule.classes.indexOf(name));
    expect(windowProbs).toHaveLength(fixture.probs.length);
    fixture.probs.forEach((expected, k) =>
      expectClose(
        windowProbs[k]!,
        order.map((c) => expected[c]!),
        1e-9,
      ),
    );
  });
});

describe('logistic rhythm rule validation', () => {
  const badRules: [string, Record<string, unknown>, RegExp][] = [
    ['another method', { method: 'probs = sigmoid(z)' }, /method/],
    ['too few featureIndices', { featureIndices: [0] }, /length/],
    ['too few means', { mean: [0] }, /length/],
    ['too many scales', { scale: [1, 1, 1] }, /length/],
    ['too few feature names', { features: ['first'] }, /length/],
    [
      'too few coefficient rows',
      {
        coefficients: [
          [0, 0],
          [1, 0],
        ],
      },
      /length/,
    ],
    ['a short coefficient row', { coefficients: [[0, 0], [1], [0, 1]] }, /length/],
    ['too few intercepts', { intercepts: [0, 0] }, /length/],
    ['a zero scale', { scale: [1, 0] }, /scale/],
    ['a negative scale', { scale: [1, -1] }, /scale/],
    // StandardScaler's scale_ is sqrt(var_), or 1 for a constant feature: never below about 2.2e-162.
    ['a subnormal scale', { scale: [1, 5e-324] }, /scale/],
    ['a class name that is not a string', { classes: [1, 'af', 'other'] }, /classes/],
    ['a NaN mean', { mean: [0, Number.NaN] }, /finite/],
    [
      'an infinite coefficient',
      {
        coefficients: [
          [0, 0],
          [Infinity, 0],
          [0, 1],
        ],
      },
      /finite/,
    ],
    ['a string intercept', { intercepts: [0, '1', 0] }, /finite/],
    ['an index past the vector', { featureIndices: [0, 4] }, /featureIndices/],
    ['a negative index', { featureIndices: [0, -1] }, /featureIndices/],
    ['a fractional index', { featureIndices: [0, 1.5] }, /featureIndices/],
    ['a repeated index', { featureIndices: [2, 2] }, /featureIndices/],
    ['an unknown class', { classes: ['sinus', 'af', 'noise'] }, /classes/],
    ['a repeated class', { classes: ['sinus', 'af', 'af'] }, /classes/],
    ['a missing key', { intercepts: undefined }, /intercepts/],
  ];
  it.each(badRules)('refuses a rule with %s', (_, changes, message) => {
    expect(() => logisticRhythmOutputs(toyEntry({ rule: toyRule(changes) }), [HAND_WINDOW])).toThrow(message);
  });

  it('refuses an entry without a rule, a feature shape, τ_AF, or the reading abstain line', () => {
    const refused: [Record<string, unknown>, RegExp][] = [
      [{ rule: undefined }, /rule/],
      [{ inputs: { features: [8] } }, /inputs/],
      [{ inputs: {} }, /inputs/],
      [{ threshold: { af: null } }, /threshold/],
      [{ threshold: { af: 1.5 } }, /threshold/],
      [{ threshold: {} }, /threshold/],
      // buildReadingResult abstains at rules.uncertainBelowTopProb; an entry asking for another line
      // would be silently ignored.
      [{ abstainBelow: ABSTAIN + 0.1 }, /abstainBelow/],
      [{ abstainBelow: null }, /abstainBelow/],
    ];
    for (const [changes, message] of refused)
      expect(() => logisticRhythmOutputs(toyEntry(changes), [HAND_WINDOW])).toThrow(message);
    expect(() => logisticRhythmOutputs(null, [HAND_WINDOW])).toThrow(/entry/);
  });

  it('refuses a feature vector of the wrong length or with a non-finite value', () => {
    for (const window of [[], [0, 0, 0], [0, 0, 0, 0, 0], [0, Number.NaN, 0, 0], [0, 0, Infinity, 0]])
      expect(() => logisticRhythmOutputs(toyEntry(), [HAND_WINDOW, window])).toThrow(/feature vector/);
  });

  it('refuses a window whose logits overflow a double, rather than returning NaN', () => {
    expect(() => logisticRhythmOutputs(toyEntry(), [[1.7e308, 0, 1.7e308, 0]])).not.toThrow();
    const rule = toyRule({ intercepts: [0, 1.7e308, 0] });
    expect(() => logisticRhythmOutputs(toyEntry({ rule }), [[1.7e308, 0, 0, 0]])).toThrow(/overflow/);
    const sunk = toyRule({
      coefficients: [
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      intercepts: [-1.7e308, -1.7e308, -1.7e308],
    });
    expect(() => logisticRhythmOutputs(toyEntry({ rule: sunk }), [[-1.7e308, 0, 0, 0]])).toThrow(/overflow/);
  });
});

describe('logistic rhythm rule on the full rhythm vector (v1 entry, v1 + v2 features)', () => {
  const wide = (window: number[]) => [
    ...window,
    ...new Array<number>(RHYTHM_FEATURE_NAMES.length - window.length).fill(7),
  ];

  it("reads only the entry's prefix of core's full-width vector", () => {
    const { windowProbs } = logisticRhythmOutputs(toyEntry(), [wide(HAND_WINDOW)]);
    expectClose(windowProbs[0]!, HAND_PROBS, 1e-15);
  });

  it('still refuses a non-finite value past the prefix', () => {
    const window = wide(HAND_WINDOW);
    window[RHYTHM_FEATURE_NAMES.length - 1] = Number.NaN;
    expect(() => logisticRhythmOutputs(toyEntry(), [window])).toThrow(/feature vector/);
  });

  it('checks featureOrder, when the entry lists it, against core names in order', () => {
    const names = RHYTHM_FEATURE_NAMES.slice(0, 4);
    expect(() => logisticRhythmOutputs(toyEntry({ featureOrder: names }), [HAND_WINDOW])).not.toThrow();
    const swapped = [names[1], names[0], names[2], names[3]];
    expect(() => logisticRhythmOutputs(toyEntry({ featureOrder: swapped }), [HAND_WINDOW])).toThrow(
      /featureOrder/,
    );
    expect(() => logisticRhythmOutputs(toyEntry({ featureOrder: names.slice(0, 3) }), [HAND_WINDOW])).toThrow(
      /featureOrder/,
    );
  });

  it('refuses an entry wider than the features core computes', () => {
    const entry = toyEntry({ inputs: { features: [1, RHYTHM_FEATURE_NAMES.length + 1] } });
    expect(() => logisticRhythmOutputs(entry, [HAND_WINDOW])).toThrow();
  });
});
