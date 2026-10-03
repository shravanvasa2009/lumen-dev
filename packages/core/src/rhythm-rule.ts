import { DSP_CONFIG } from './config';
import { RHYTHM_CLASSES, type RhythmOutputs } from './reading-result';
import { RHYTHM_FEATURE_NAMES } from './rhythm-features';

// §11.1's logistic rhythm rule, run in code as basic analysis (§11.10) when the shipped rhythm model does
// not load. Every number comes from the rhythm-logistic entry of models/manifest.json, which
// ml/export/write_manifest.py writes; ml/lumen_dsp/rhythm_rule.py mirrors this file (§10.2).

// The formula write_manifest records; any other method would need other math here.
const RULE_METHOD =
  'probs = softmax(coefficients · z + intercepts), z = (features[featureIndices] − mean) / scale';
const RULE_KEYS = [
  'method',
  'features',
  'featureIndices',
  'mean',
  'scale',
  'classes',
  'coefficients',
  'intercepts',
] as const;

// The smallest normal double. write_manifest copies StandardScaler's scale_, which is sqrt(var_) (at least
// about 2.2e-162) or 1 for a constant feature, so only a hand-edited manifest has a smaller scale, and a
// subnormal one overflows z for almost any feature.
const SMALLEST_NORMAL = 2.2250738585072014e-308;

// Errors about the manifest are plain Errors; errors about the windows passed in are RangeErrors, so a
// caller can tell a broken manifest from a bad reading.

interface LogisticRule {
  featureIndices: number[];
  mean: number[];
  scale: number[];
  classes: string[];
  coefficients: number[][];
  intercepts: number[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// Array.from reads each element once and turns holes into undefined, so what is checked is what is used:
// a getter or Proxy cannot change a value afterwards, and every() cannot skip a hole.
const copyOf = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? Array.from(value as unknown[]) : null;

function finiteNumbers(value: unknown, name: string, length: number): number[] {
  const copy = copyOf(value);
  if (copy === null || copy.length !== length)
    throw new Error(`rule ${name} has the wrong length (need ${length})`);
  if (!copy.every(isFiniteNumber)) throw new Error(`rule ${name} has a value that is not a finite number`);
  return copy;
}

function readRule(rule: unknown, featureCount: number): LogisticRule {
  if (!isRecord(rule)) throw new Error('the manifest entry has no rule block');
  const missing = RULE_KEYS.filter((key) => rule[key] === undefined);
  if (missing.length > 0) throw new Error(`rule is missing ${missing.join(', ')}`);
  if (rule.method !== RULE_METHOD)
    throw new Error(`rule method ${JSON.stringify(rule.method)} is not ${RULE_METHOD}`);
  const indices = copyOf(rule.featureIndices);
  if (indices === null || indices.length === 0)
    throw new Error('rule featureIndices has the wrong length (need at least 1)');
  if (
    !indices.every(
      (index) => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < featureCount,
    ) ||
    new Set(indices).size !== indices.length
  )
    throw new Error(
      `rule featureIndices ${JSON.stringify(indices)} must be distinct integers below ${featureCount}`,
    );
  const columns = indices.length;
  if (copyOf(rule.features)?.length !== columns)
    throw new Error(`rule features has the wrong length (need ${columns})`);
  const mean = finiteNumbers(rule.mean, 'mean', columns);
  const scale = finiteNumbers(rule.scale, 'scale', columns);
  if (!scale.every((value) => value >= SMALLEST_NORMAL))
    throw new Error(`rule scale must be a normal positive number (at least ${SMALLEST_NORMAL})`);
  const classes = copyOf(rule.classes);
  if (
    classes === null ||
    classes.length !== RHYTHM_CLASSES.length ||
    !classes.every((name) => typeof name === 'string') ||
    !RHYTHM_CLASSES.every((name) => classes.includes(name))
  )
    throw new Error(
      `rule classes ${JSON.stringify(classes)} must be ${RHYTHM_CLASSES.join(', ')} in some order`,
    );
  const rows = copyOf(rule.coefficients);
  if (rows === null || rows.length !== classes.length)
    throw new Error(`rule coefficients has the wrong length (need ${classes.length} rows)`);
  return {
    featureIndices: indices as number[],
    mean,
    scale,
    classes: classes as string[],
    coefficients: rows.map((row) => finiteNumbers(row, 'coefficients', columns)),
    intercepts: finiteNumbers(rule.intercepts, 'intercepts', classes.length),
  };
}

// The rule takes the same features [1, n] input as the rhythm model it stands in for.
function featureCountOf(inputs: unknown): number {
  const shape = isRecord(inputs) ? inputs.features : undefined;
  if (
    !Array.isArray(shape) ||
    shape.length !== 2 ||
    shape[0] !== 1 ||
    !Number.isInteger(shape[1]) ||
    shape[1] < 1
  )
    throw new Error(`the entry's inputs.features must be [1, n], not ${JSON.stringify(shape)}`);
  return shape[1] as number;
}

function tauAfOf(threshold: unknown): number {
  const tauAf = isRecord(threshold) ? threshold.af : undefined;
  if (!isFiniteNumber(tauAf) || tauAf < 0 || tauAf > 1)
    throw new Error(`the entry's threshold.af must be a probability, not ${JSON.stringify(tauAf)}`);
  return tauAf;
}

function ruleProbs(rule: LogisticRule, vector: readonly number[]): number[] {
  const z = rule.featureIndices.map((index, k) => (vector[index]! - rule.mean[k]!) / rule.scale[k]!);
  const logits = rule.coefficients.map((row, c) => {
    let logit = rule.intercepts[c]!;
    row.forEach((weight, k) => (logit += weight * z[k]!));
    return logit;
  });
  // An overflowed logit makes logit − top ∞ − ∞ = NaN. A window that far outside the training data has no
  // meaningful probability, so it is refused rather than given a saturated one.
  if (!logits.every(Number.isFinite))
    throw new RangeError('a feature vector overflows the rule logits to a non-finite number');
  // Shifting by the largest logit leaves the softmax unchanged and keeps exp() from overflowing.
  const top = Math.max(...logits);
  const exps = logits.map((logit) => Math.exp(logit - top));
  let total = 0;
  for (const value of exps) total += value;
  return exps.map((value) => value / total);
}

/** §11.1 basic analysis: the manifest's rhythm-logistic rule on each DSP-15 window, as RhythmOutputs. */
export function logisticRhythmOutputs(
  entry: unknown,
  windowFeatures: readonly (readonly number[])[],
): RhythmOutputs {
  if (!isRecord(entry)) throw new Error('the rhythm-logistic manifest entry must be an object');
  const featureCount = featureCountOf(entry.inputs);
  const rule = readRule(entry.rule, featureCount);
  const tauAf = tauAfOf(entry.threshold);
  // buildReadingResult abstains at rules.uncertainBelowTopProb (§10.1), so an entry asking for another
  // line would be silently ignored.
  const abstainLine = DSP_CONFIG.rules.uncertainBelowTopProb;
  if (entry.abstainBelow !== abstainLine)
    throw new Error(`the entry's abstainBelow ${JSON.stringify(entry.abstainBelow)} is not ${abstainLine}`);
  // Core computes every rhythm feature (RHYTHM_FEATURE_NAMES); an entry reads the prefix it was trained on,
  // so a v1 rule keeps working on the wider v2 vector. Names, when the entry lists them, must be that prefix.
  if (featureCount > RHYTHM_FEATURE_NAMES.length)
    throw new Error(
      `the entry asks for ${featureCount} features; core computes ${RHYTHM_FEATURE_NAMES.length}`,
    );
  const expectedOrder = RHYTHM_FEATURE_NAMES.slice(0, featureCount);
  if (
    entry.featureOrder !== undefined &&
    (!Array.isArray(entry.featureOrder) ||
      entry.featureOrder.length !== featureCount ||
      entry.featureOrder.some((name, i) => name !== expectedOrder[i]))
  )
    throw new Error(`the entry's featureOrder must be ${JSON.stringify(expectedOrder)}`);
  // Only the entry's own width or core's full width: any other length is an upstream fault. Every value must
  // be finite, read or not (ADR 0024 makes every DSP-15 feature finite).
  const widths = [featureCount, RHYTHM_FEATURE_NAMES.length];
  const vectors = Array.from(windowFeatures, (vector: unknown) => {
    const copy = copyOf(vector);
    if (copy === null || !widths.includes(copy.length) || !copy.every(isFiniteNumber))
      throw new RangeError(`each feature vector needs ${widths.join(' or ')} finite numbers`);
    return copy.slice(0, featureCount);
  });

  const classOrder = RHYTHM_CLASSES.map((name) => rule.classes.indexOf(name));
  return {
    windowProbs: vectors.map((vector) => {
      const probs = ruleProbs(rule, vector);
      return classOrder.map((c) => probs[c]!) as [number, number, number];
    }),
    tauAf,
  };
}
