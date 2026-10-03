import { Asset } from 'expo-asset';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { type DiabetesModelInput, SHAPE_FEATURE_NAMES } from '@lumen/core';
import type { InferenceSession } from 'onnxruntime-react-native';

import { isRecord } from '../evidence';
import { bundledManifest, bundledModelFiles } from './bundled-models';

// §11.10 runtime: the manifest's one shipped model per family, loaded on first use, with basic analysis
// (the classical fallback) whenever a model is missing, refused, fails to load, or fails a run.

export type ModelFamily = 'rhythm' | 'sqi' | 'diabetes';
export type ModelRole = 'gate' | 'guard';

const families: readonly ModelFamily[] = ['rhythm', 'sqi', 'diabetes'];

// ADR 0038 (owner decision H-024 option B) and ml/export/specs.py: an SQI model is a reject-only guard and
// every other model is a gate. A shipped role its family doesn't allow is refused, so changing a role needs
// a code change here as well as the owner's decision.
const familyRole: Readonly<Record<ModelFamily, ModelRole>> = {
  rhythm: 'gate',
  sqi: 'guard',
  diabetes: 'gate',
};

// §11.10: each inference gets 50 ms; a slower run uses basic analysis for that call.
const INFERENCE_TIMEOUT_MS = 50;

type Shape = readonly number[];

type ShippedModel = {
  name: string;
  version: string;
  role: ModelRole;
  file: string;
  sha256: string;
  inputs: Readonly<Record<string, Shape>>;
  outputs: Readonly<Record<string, Shape>>;
  labels: readonly string[];
  threshold: Readonly<Record<string, number | null>>;
  abstainBelow: number | null;
  // The one output shaped [1, labels.length]: a score per label. Other outputs (a LightGBM `label`) are
  // read and recorded, not scored.
  scoreOutput: string;
  // Per input, the training median of each of its features in order, for a value core left null (§11.4).
  // Only the diabetes model has any; readShipped refuses a diabetes model whose manifest entry has none.
  fills: Readonly<Record<string, readonly number[]>>;
};

type FamilyPlan = { model: ShippedModel; assetModule: number } | { reason: string };

export type ModelPlan =
  { source: 'model'; name: string; version: string; role: ModelRole } | { source: 'basic'; reason: string };

export type ModelFeed = { values: Float32Array; dims: readonly number[] };
export type ModelFeeds = Readonly<Record<string, ModelFeed>>;

export type ModelId = { name: string; version: string; role: ModelRole };

export type BasicAnalysis = { source: 'basic'; value: null; reason: string };

export type ScoreOutcome =
  | {
      source: 'model';
      model: ModelId;
      scores: Readonly<Record<string, number>>;
      // Every manifest output, int64 ones as numbers, for the saved reading (§11.10).
      outputs: Readonly<Record<string, number[]>>;
      threshold: Readonly<Record<string, number | null>>;
      abstainBelow: number | null;
    }
  | BasicAnalysis;

// A guard can only add a rejection to a window the rule checks accepted (ADR 0038), so the outcome carries a
// veto and nothing a caller could read as "accept". Basic analysis never vetoes: the rules alone decide.
export type SqiVeto = { source: 'model'; model: ModelId; veto: boolean } | (BasicAnalysis & { veto: false });

type Ort = typeof import('onnxruntime-react-native');
type LoadedModel = { ort: Ort; session: InferenceSession };
type ModelRun = { model: ShippedModel; outputs: Record<string, number[]> };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isShape(value: unknown): value is Shape {
  return Array.isArray(value) && value.length > 0 && value.every((dim) => Number.isInteger(dim) && dim > 0);
}

function readShapes(value: unknown): Record<string, Shape> | null {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;
  return Object.values(value).every(isShape) ? (value as Record<string, Shape>) : null;
}

function sameShape(left: Shape, right: Shape): boolean {
  return left.length === right.length && left.every((dim, index) => dim === right[index]);
}

function shapeSize(shape: Shape): number {
  return shape.reduce((product, dim) => product * dim, 1);
}

const diabetesFilledInputs = ['shapeFeatures', 'hrSummary'] as const;

function readFills(entry: Record<string, unknown>, inputs: Readonly<Record<string, Shape>>) {
  const { featureOrder, fillMedians } = entry;
  if (!isRecord(featureOrder) || !isRecord(fillMedians)) return 'it has no featureOrder or fillMedians';
  const fills: Record<string, number[]> = {};
  for (const input of diabetesFilledInputs) {
    const names = featureOrder[input];
    const width = inputs[input]?.[1];
    if (!Array.isArray(names) || names.length !== width)
      return `its featureOrder.${input} does not list the ${width} features of that input`;
    // Core builds shapeFeatures in SHAPE_FEATURE_NAMES order; a manifest in another order would put each
    // feature, and each null's median, in the wrong model slot. Core exports no name list for hrSummary
    // yet, so that input is checked for width only.
    if (input === 'shapeFeatures' && names.some((name, index) => name !== SHAPE_FEATURE_NAMES[index]))
      return `its featureOrder.shapeFeatures is not core's order: ${SHAPE_FEATURE_NAMES.join(', ')}`;
    const medians = names.map((name) => (typeof name === 'string' ? fillMedians[name] : undefined));
    if (!medians.every((median): median is number => typeof median === 'number' && Number.isFinite(median)))
      return `its fillMedians has no finite median for every ${input} feature`;
    fills[input] = medians;
  }
  return fills;
}

function readShipped(entry: Record<string, unknown>, family: ModelFamily): ShippedModel | string {
  const { name, version, role, file, sha256, labels, threshold } = entry;
  if (typeof name !== 'string' || typeof version !== 'string') return 'its name or version is missing';
  const id = `${name}@${version}`;
  if (role !== 'gate' && role !== 'guard')
    return `${id} has role ${JSON.stringify(role)}, not "gate" or "guard"`;
  if (role !== familyRole[family])
    return `${id} has role "${role}", but ${family} models must be "${familyRole[family]}"`;
  if (typeof file !== 'string') return `${id} has no file`;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) return `${id} has no valid sha256`;
  const inputs = readShapes(entry.inputs);
  const outputs = readShapes(entry.outputs);
  if (!inputs || !outputs) return `${id} has invalid input or output shapes`;
  if (!Array.isArray(labels) || labels.length === 0 || !labels.every((label) => typeof label === 'string'))
    return `${id} has no labels`;
  if (
    !isRecord(threshold) ||
    !Object.values(threshold).every((cut) => cut === null || typeof cut === 'number')
  )
    return `${id} has an invalid threshold`;
  const abstainBelow = entry.abstainBelow ?? null;
  if (abstainBelow !== null && typeof abstainBelow !== 'number') return `${id} has an invalid abstainBelow`;
  const scoreOutputs = Object.keys(outputs).filter((output) =>
    sameShape(outputs[output] ?? [], [1, labels.length]),
  );
  if (scoreOutputs.length !== 1)
    return `${id} has ${scoreOutputs.length} outputs shaped [1, ${labels.length}], not 1`;
  // The guard compares its one score (P(clean)) with that label's threshold (ADR 0038: pClean < threshold.clean).
  if (role === 'guard' && (labels.length !== 1 || typeof threshold[labels[0] as string] !== 'number'))
    return `${id} is a guard without one label and a numeric threshold for it`;
  const fills = family === 'diabetes' ? readFills(entry, inputs) : {};
  if (typeof fills === 'string') return `${id} cannot be fed a missing value: ${fills}`;
  return {
    name,
    version,
    role,
    file,
    sha256: sha256.toLowerCase(),
    inputs,
    outputs,
    labels: labels as string[],
    threshold: threshold as Record<string, number | null>,
    abstainBelow,
    scoreOutput: scoreOutputs[0] as string,
    fills,
  };
}

function planFamily(
  manifest: unknown,
  files: Readonly<Record<string, number>>,
  family: ModelFamily,
): FamilyPlan {
  if (manifest === null) return { reason: 'no model manifest is bundled' };
  if (!isRecord(manifest) || !Array.isArray(manifest.models))
    return { reason: 'the model manifest has no models list' };
  const shipped = manifest.models.filter(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.family === family && entry.ships === true,
  );
  // ADR 0031: exactly one model per family ships; anything else is a broken manifest, not a choice to make here.
  if (shipped.length !== 1) return { reason: `the manifest ships ${shipped.length} ${family} models, not 1` };
  const model = readShipped(shipped[0] as Record<string, unknown>, family);
  if (typeof model === 'string') return { reason: `refused the shipped ${family} model: ${model}` };
  const assetModule = files[model.file];
  if (assetModule === undefined) return { reason: `${model.file} is not bundled with the app` };
  return { model, assetModule };
}

const plans = Object.fromEntries(
  families.map((family) => [family, planFamily(bundledManifest, bundledModelFiles, family)]),
) as Record<ModelFamily, FamilyPlan>;

export function modelPlan(): Record<ModelFamily, ModelPlan> {
  return Object.fromEntries(
    families.map((family): [ModelFamily, ModelPlan] => {
      const plan = plans[family];
      if ('reason' in plan) return [family, { source: 'basic', reason: plan.reason }];
      const { name, version, role } = plan.model;
      return [family, { source: 'model', name, version, role }];
    }),
  ) as Record<ModelFamily, ModelPlan>;
}

function hex(digestBytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function inputTensors(
  ort: Ort,
  model: ShippedModel,
  valuesFor: (shape: Shape, input: string) => Float32Array,
): InferenceSession.FeedsType {
  return Object.fromEntries(
    Object.entries(model.inputs).map(([input, shape]) => [
      input,
      new ort.Tensor('float32', valuesFor(shape, input), [...shape]),
    ]),
  );
}

async function loadModel(model: ShippedModel, assetModule: number): Promise<LoadedModel> {
  // Importing the package runs its native install(); a dynamic import keeps a failed install a fallback.
  const ort = await import('onnxruntime-react-native');
  const [asset] = await Asset.loadAsync(assetModule);
  if (!asset?.localUri) throw new Error('expo-asset gave no local file');
  // onnxruntime #26738: iOS release builds can't open expo-asset's localUri, so ONNX Runtime opens a copy in
  // the documents directory, and that copy is the file whose sha256 is checked (§11.9).
  const folder = new Directory(Paths.document, 'models');
  folder.create({ intermediates: true, idempotent: true });
  const copy = new File(folder, model.file);
  await new File(asset.localUri).copy(copy, { overwrite: true });
  const actual = hex(await digest(CryptoDigestAlgorithm.SHA256, await copy.bytes()));
  if (actual !== model.sha256)
    throw new Error(`sha256 ${actual} does not match the manifest's ${model.sha256}`);
  const session = await ort.InferenceSession.create(copy.uri);
  const expectedInputs = Object.keys(model.inputs).sort().join(', ');
  const modelInputs = [...session.inputNames].sort().join(', ');
  if (modelInputs !== expectedInputs)
    throw new Error(`model inputs ${modelInputs} differ from the manifest's ${expectedInputs}`);
  const missingOutputs = Object.keys(model.outputs).filter((output) => !session.outputNames.includes(output));
  if (missingOutputs.length > 0) throw new Error(`model has no output ${missingOutputs.join(', ')}`);
  // A session's first run pays one-off setup costs; doing it here, outside the 50 ms budget, keeps the first
  // real window or reading from falling back for that reason alone.
  await session.run(inputTensors(ort, model, (shape) => new Float32Array(shapeSize(shape))));
  return { ort, session };
}

const loading = new Map<ModelFamily, Promise<LoadedModel>>();

function loadOnce(family: ModelFamily, model: ShippedModel, assetModule: number): Promise<LoadedModel> {
  const pending = loading.get(family) ?? loadModel(model, assetModule);
  loading.set(family, pending);
  return pending;
}

function feedMismatch(model: ShippedModel, feeds: ModelFeeds): string | null {
  for (const [input, shape] of Object.entries(model.inputs)) {
    const feed = feeds[input];
    if (!feed) return `no ${input} input`;
    if (!sameShape(feed.dims, shape))
      return `${input} is [${feed.dims.join(', ')}], the manifest says [${shape.join(', ')}]`;
    const size = shapeSize(shape);
    if (feed.values.length !== size)
      return `${input} has ${feed.values.length} values, [${shape.join(', ')}] needs ${size}`;
  }
  return null;
}

async function runWithin(
  session: InferenceSession,
  feeds: InferenceSession.FeedsType,
  limitMs: number,
): Promise<InferenceSession.ReturnType> {
  const startedMs = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`inference took longer than ${limitMs} ms`)), limitMs);
  });
  const outputs = await Promise.race([session.run(feeds), timeout]).finally(() => clearTimeout(timer));
  // A run that blocks the JS thread finishes before the timer can fire, so a late result is discarded too.
  const elapsedMs = Date.now() - startedMs;
  if (elapsedMs > limitMs) throw new Error(`inference took ${elapsedMs} ms, longer than ${limitMs} ms`);
  return outputs;
}

function readOutputs(model: ShippedModel, outputs: InferenceSession.ReturnType): Record<string, number[]> {
  const values: Record<string, number[]> = {};
  for (const output of Object.keys(model.outputs)) {
    const tensor = outputs[output];
    if (!tensor) throw new Error(`the run returned no ${output}`);
    if (tensor.type === 'string' || tensor.type === 'bool')
      throw new Error(`${output} is ${tensor.type}, not numeric`);
    // An int64 output (a LightGBM label) arrives as a BigInt64Array.
    values[output] = Array.from(tensor.data as ArrayLike<number | bigint>, Number);
  }
  const scores = values[model.scoreOutput] ?? [];
  if (scores.length !== model.labels.length)
    throw new Error(`${model.scoreOutput} has ${scores.length} values for ${model.labels.length} labels`);
  // A NaN P(clean) would compare false and never veto, so a non-finite score is a failed run.
  if (!scores.every(Number.isFinite)) throw new Error(`${model.scoreOutput} has a non-finite score`);
  return values;
}

function basic(reason: string): BasicAnalysis {
  return { source: 'basic', value: null, reason };
}

async function runFamily(family: ModelFamily, feeds: ModelFeeds): Promise<ModelRun | BasicAnalysis> {
  const plan = plans[family];
  if ('reason' in plan) return basic(plan.reason);
  const { model, assetModule } = plan;
  const id = `${model.name}@${model.version}`;
  const mismatch = feedMismatch(model, feeds);
  if (mismatch) return basic(`${id} input check failed: ${mismatch}`);
  let loaded: LoadedModel;
  try {
    loaded = await loadOnce(family, model, assetModule);
  } catch (error) {
    return basic(`${id} did not load: ${errorMessage(error)}`);
  }
  const { ort, session } = loaded;
  try {
    const tensors = inputTensors(ort, model, (_, input) => (feeds[input] as ModelFeed).values);
    return {
      model,
      outputs: readOutputs(model, await runWithin(session, tensors, INFERENCE_TIMEOUT_MS)),
    };
  } catch (error) {
    return basic(`${id} failed this run: ${errorMessage(error)}`);
  }
}

function modelId({ name, version, role }: ShippedModel): ModelId {
  return { name, version, role };
}

async function scoreFamily(family: ModelFamily, feeds: ModelFeeds): Promise<ScoreOutcome> {
  const run = await runFamily(family, feeds);
  if (!('model' in run)) return run;
  const { model, outputs } = run;
  const scores = outputs[model.scoreOutput] as number[];
  return {
    source: 'model',
    model: modelId(model),
    scores: Object.fromEntries(model.labels.map((label, index) => [label, scores[index] as number])),
    outputs,
    threshold: model.threshold,
    abstainBelow: model.abstainBelow,
  };
}

// ADR 0079: the core vector is the v1 features followed by the v2 ones, so a model declaring a narrower width
// gets the leading values it was trained on. A window with fewer values than declared is left as it is, and
// the input check refuses it with its reason.
function rhythmFeedAtManifestWidth(feeds: ModelFeeds): ModelFeeds {
  const plan = plans.rhythm;
  const feed = feeds.features;
  const width = 'model' in plan ? plan.model.inputs.features?.[1] : undefined;
  if (feed === undefined || width === undefined || feed.values.length <= width) return feeds;
  if (!sameShape(feed.dims, [1, feed.values.length])) return feeds;
  return { ...feeds, features: { values: feed.values.slice(0, width), dims: [1, width] } };
}

// §11.3; the logistic-rule fallback is not in @lumen/core yet, so basic analysis has no value.
export function classifyRhythm(feeds: ModelFeeds): Promise<ScoreOutcome> {
  return scoreFamily('rhythm', rhythmFeedAtManifestWidth(feeds));
}

// §11.4; the logistic-regression fallback is not in @lumen/core yet, so basic analysis has no value.
export function scoreDiabetesPattern(feeds: ModelFeeds): Promise<ScoreOutcome> {
  return scoreFamily('diabetes', feeds);
}

// §11.4: core leaves a feature it could not compute null; the model's training median stands in for it here.
export function scoreDiabetesInput({ beat, shapeFeatures, hrSummary }: DiabetesModelInput): Promise<ScoreOutcome> {
  const plan = plans.diabetes;
  if ('reason' in plan) return Promise.resolve(basic(plan.reason));
  const { inputs, fills } = plan.model;
  const feed = (values: ArrayLike<number>, input: string): ModelFeed => ({
    values: Float32Array.from(values),
    dims: inputs[input] ?? [],
  });
  const filled = (values: readonly (number | null)[], input: string) =>
    feed(
      values.map((value, index) => {
        const median = fills[input]?.[index];
        if (value === null && median === undefined) throw new Error(`no median for ${input}[${index}]`);
        return value ?? (median as number);
      }),
      input,
    );
  return scoreDiabetesPattern({
    beat: feed(beat, 'beat'),
    shapeFeatures: filled(shapeFeatures, 'shapeFeatures'),
    hrSummary: filled(hrSummary, 'hrSummary'),
  });
}

export async function sqiVeto(feeds: ModelFeeds): Promise<SqiVeto> {
  const run = await runFamily('sqi', feeds);
  if (!('model' in run)) return { ...run, veto: false };
  const { model, outputs } = run;
  const label = model.labels[0] as string;
  const pClean = (outputs[model.scoreOutput] as number[])[0] as number;
  return { source: 'model', model: modelId(model), veto: pClean < (model.threshold[label] as number) };
}

// §11.2: SQI-Net's P(clean) cut-off from the manifest, or null while no SQI model ships.
export function sqiThreshold(): number | null {
  const plan = plans.sqi;
  if ('reason' in plan) return null;
  return plan.model.threshold[plan.model.labels[0] as string] as number;
}

export type SqiScore = { source: 'model'; pClean: number } | BasicAnalysis;

// The live session wants the score itself, not a veto: it applies the threshold to the 4 s it rejects (ADR 0042).
export async function scoreSqiWindow(window: Float32Array): Promise<SqiScore> {
  const plan = plans.sqi;
  if ('reason' in plan) return basic(plan.reason);
  const [input, dims] = Object.entries(plan.model.inputs)[0] as [string, Shape];
  const run = await runFamily('sqi', { [input]: { values: window, dims } });
  if (!('model' in run)) return run;
  return { source: 'model', pClean: (run.outputs[run.model.scoreOutput] as number[])[0] as number };
}
