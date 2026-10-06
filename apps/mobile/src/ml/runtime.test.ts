/** @jest-environment node */
import { HR_SUMMARY_NAMES, RHYTHM_FEATURE_NAMES, SHAPE_FEATURE_NAMES } from '@lumen/core';
import type * as OrtNode from 'onnxruntime-node';

import expectedRhythm from './__fixtures__/rhythm-lgbm-fixture.expected.json';
import type * as Runtime from './runtime';

// The app tsconfig has no Node types, so the Node modules this test needs are typed here.
type Hash = { update(bytes: Uint8Array): Hash; digest(encoding: 'hex'): string };
const { createHash } = jest.requireActual<{ createHash(algorithm: 'sha256'): Hash }>('crypto');
const fs = jest.requireActual<{
  mkdtempSync(prefix: string): string;
  readFileSync(file: string): Uint8Array;
  rmSync(dir: string, options: { recursive: true; force: true }): void;
}>('fs');
const os = jest.requireActual<{ tmpdir(): string }>('os');
const path = jest.requireActual<{ join(...parts: string[]): string; dirname(file: string): string }>('path');
const { pathToFileURL } = jest.requireActual<{ pathToFileURL(file: string): { href: string } }>('url');

// Test doubles for native modules Jest can't load (ADR 0050). Each does the real operation in Node:
// onnxruntime-node 1.24.3 is the same ONNX Runtime the phone links, and the file and hash doubles use fs and
// node:crypto. App code never imports any of this.
const mockAssetUris = new Map<number, string>();
const mockDocuments = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-ml-'));
const mockSessionsCreated = { count: 0 };

function mockOnnxRuntime() {
  // onnxruntime-node builds its output tensors in Node's main realm, and onnxruntime-common checks typed arrays
  // with instanceof, so loaded inside Jest's sandbox realm every output fails that check. The double loads it
  // with the main realm's require and copies each input into that realm's Float32Array.
  const vm = jest.requireActual('vm');
  const ortNode: typeof OrtNode = vm.runInThisContext('process').mainModule.require('onnxruntime-node');
  const MainFloat32Array = vm.runInThisContext('Float32Array');
  const { fileURLToPath } = jest.requireActual('url');
  return {
    // runtime.ts only builds float32 inputs.
    Tensor: function Tensor(type: 'float32', values: Float32Array, dims: number[]) {
      return new ortNode.Tensor(type, MainFloat32Array.from(values), dims);
    },
    InferenceSession: {
      // The phone's C++ loader strips the file:// prefix; onnxruntime-node wants a plain path. One thread
      // each, because Jest runs suites in parallel and the slow fixture would otherwise take every core.
      create: (uri: string) => {
        mockSessionsCreated.count += 1;
        return ortNode.InferenceSession.create(fileURLToPath(uri), { intraOpNumThreads: 1 });
      },
    },
  };
}
jest.mock('onnxruntime-react-native', () => mockOnnxRuntime());

jest.mock('expo-asset', () => ({
  Asset: {
    loadAsync: async (assetModule: number) => [{ localUri: mockAssetUris.get(assetModule) ?? null }],
  },
}));

jest.mock('expo-file-system', () => {
  const nodeFs = jest.requireActual('node:fs');
  const nodePath = jest.requireActual('node:path');
  const url = jest.requireActual('node:url');
  type MockPart = string | { filePath: string };
  const toPath = (part: MockPart) =>
    typeof part !== 'string' ? part.filePath : part.startsWith('file:') ? url.fileURLToPath(part) : part;
  class Directory {
    filePath: string;
    constructor(...parts: MockPart[]) {
      this.filePath = nodePath.join(...parts.map(toPath));
    }
    create() {
      nodeFs.mkdirSync(this.filePath, { recursive: true });
    }
  }
  class File {
    filePath: string;
    constructor(...parts: MockPart[]) {
      this.filePath = nodePath.join(...parts.map(toPath));
    }
    get uri() {
      return url.pathToFileURL(this.filePath).href;
    }
    async copy(destination: File) {
      nodeFs.copyFileSync(this.filePath, destination.filePath);
    }
    async bytes() {
      return new Uint8Array(nodeFs.readFileSync(this.filePath));
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document() {
        return new Directory(mockDocuments);
      },
    },
  };
});

jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (algorithm: string, bytes: Uint8Array) => {
      if (algorithm !== 'SHA-256') throw new Error(`unexpected digest ${algorithm}`);
      const hash: Uint8Array = nodeCrypto.createHash('sha256').update(bytes).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    },
  };
});

function fixturesFolder(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('Jest did not report this test file path');
  return path.join(path.dirname(testPath), '__fixtures__');
}
const fixtures = fixturesFolder();

function fixtureSha256(fixture: string): string {
  return createHash('sha256')
    .update(fs.readFileSync(path.join(fixtures, fixture)))
    .digest('hex');
}

const rhythmFile = 'rhythm-lgbm@1.0.0.onnx';
const sqiFile = 'sqi-finger@1.0.0.onnx';
const diabetesFile = 'diabetes-net@1.0.0.onnx';
const fixtureFor: Record<string, string> = {
  [rhythmFile]: 'rhythm-lgbm-fixture.onnx',
  [sqiFile]: 'sqi-fixture.onnx',
  [diabetesFile]: 'diabetes-fixture.onnx',
};

function rhythmEntry(changes: Record<string, unknown> = {}) {
  const declared = (changes.inputs as { features?: number[] } | undefined)?.features?.[1] ?? 8;
  return {
    name: 'rhythm-lgbm',
    version: '1.0.0',
    family: 'rhythm',
    ships: true,
    role: 'gate',
    file: rhythmFile,
    sha256: fixtureSha256('rhythm-lgbm-fixture.onnx'),
    inputs: { features: [1, 8] },
    outputs: { label: [1], probabilities: [1, 3] },
    labels: ['sinus', 'af', 'other'],
    threshold: { af: 0.5 },
    abstainBelow: 0.6,
    featureOrder: RHYTHM_FEATURE_NAMES.slice(0, declared),
    ...changes,
  };
}

function sqiEntry(changes: Record<string, unknown> = {}) {
  return {
    name: 'sqi-finger',
    version: '1.0.0',
    family: 'sqi',
    ships: true,
    role: 'guard',
    file: sqiFile,
    sha256: fixtureSha256('sqi-fixture.onnx'),
    inputs: { window: [1, 1, 256] },
    outputs: { pClean: [1, 1] },
    labels: ['clean'],
    threshold: { clean: 0.5 },
    abstainBelow: null,
    ...changes,
  };
}

const holed = (names: readonly string[]) => {
  const copy: string[] = [...names];
  delete copy[1];
  return copy;
};
const ownSome = (names: readonly string[]) => Object.assign([...names], { some: () => false });

const shapeFeatureNames: string[] = [...SHAPE_FEATURE_NAMES];
const hrSummaryNames: string[] = [...HR_SUMMARY_NAMES];
// Every median is different, so a null filled from the wrong slot gives a different score.
const fillMedians = Object.fromEntries(
  [...shapeFeatureNames, ...hrSummaryNames].map((name, index) => [name, 0.1 * index - 0.7]),
);

function diabetesEntry(changes: Record<string, unknown> = {}) {
  return {
    name: 'diabetes-net',
    version: '1.0.0',
    family: 'diabetes',
    ships: true,
    role: 'gate',
    file: diabetesFile,
    sha256: fixtureSha256('diabetes-fixture.onnx'),
    inputs: { beat: [1, 1, 256], shapeFeatures: [1, 12], hrSummary: [1, 4] },
    outputs: { pPattern: [1, 1] },
    labels: ['pattern'],
    threshold: { pattern: 0.5 },
    abstainBelow: null,
    featureOrder: { shapeFeatures: shapeFeatureNames, hrSummary: hrSummaryNames },
    fillMedians,
    ...changes,
  };
}

let nextAssetModule = 1;

// A fresh runtime module per test, with its own manifest, bundled files and session cache.
async function loadRuntime(
  manifest: unknown,
  files: Record<string, string> = fixtureFor,
  folder: string = fixtures,
): Promise<typeof Runtime> {
  const bundledModelFiles: Record<string, number> = {};
  for (const [file, fixture] of Object.entries(files)) {
    const assetModule = nextAssetModule++;
    mockAssetUris.set(assetModule, pathToFileURL(path.join(folder, fixture)).href);
    bundledModelFiles[file] = assetModule;
  }
  let runtime: typeof Runtime | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('./bundled-models', () => ({ bundledManifest: manifest, bundledModelFiles }));
    runtime = await import('./runtime');
  });
  if (!runtime) throw new Error('runtime did not load');
  return runtime;
}

const features = { features: { values: Float32Array.from(expectedRhythm.features), dims: [1, 8] } };
const windowAt = (level: number) => ({
  window: { values: new Float32Array(256).fill(level), dims: [1, 1, 256] },
});

beforeEach(() => {
  mockSessionsCreated.count = 0;
});

afterAll(() => {
  fs.rmSync(mockDocuments, { recursive: true, force: true });
});

describe('no manifest', () => {
  it('starts with every family on basic analysis', async () => {
    const runtime = await loadRuntime(null, {});
    const reason = 'no model manifest is bundled';
    expect(runtime.modelPlan()).toEqual({
      rhythm: { source: 'basic', reason },
      sqi: { source: 'basic', reason },
      diabetes: { source: 'basic', reason },
    });
    expect(await runtime.classifyRhythm(features)).toEqual({ source: 'basic', value: null, reason });
    expect(await runtime.sqiVeto(windowAt(3))).toEqual({ source: 'basic', value: null, reason, veto: false });
    expect(await runtime.scoreDiabetesPattern({})).toEqual({ source: 'basic', value: null, reason });
    expect(mockSessionsCreated.count).toBe(0);
  });

  it('treats a manifest without a models list as no models', async () => {
    const runtime = await loadRuntime({ entries: [] });
    expect(runtime.modelPlan().rhythm).toEqual({
      source: 'basic',
      reason: 'the model manifest has no models list',
    });
  });
});

describe('ships filtering', () => {
  it('uses basic analysis when a family ships no model', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry({ ships: false }), sqiEntry()] });
    expect(runtime.modelPlan().rhythm).toEqual({
      source: 'basic',
      reason: 'the manifest ships 0 rhythm models, not 1',
    });
    expect(runtime.modelPlan().diabetes).toEqual({
      source: 'basic',
      reason: 'the manifest ships 0 diabetes models, not 1',
    });
    expect(runtime.modelPlan().sqi).toEqual({
      source: 'model',
      name: 'sqi-finger',
      version: '1.0.0',
      role: 'guard',
    });
  });

  it('loads the one shipped model and ignores the ablation entries', async () => {
    const ablation = rhythmEntry({ name: 'rhythm-net', ships: false, file: 'rhythm-net@1.0.0.onnx' });
    const runtime = await loadRuntime({ models: [ablation, rhythmEntry()] });
    expect(runtime.modelPlan().rhythm).toEqual({
      source: 'model',
      name: 'rhythm-lgbm',
      version: '1.0.0',
      role: 'gate',
    });
    expect(await runtime.classifyRhythm(features)).toMatchObject({ source: 'model' });
  });

  it('uses basic analysis when a family ships two models', async () => {
    const second = rhythmEntry({ name: 'rhythm-net', file: 'rhythm-net@1.0.0.onnx' });
    const runtime = await loadRuntime({ models: [rhythmEntry(), second] });
    const reason = 'the manifest ships 2 rhythm models, not 1';
    expect(runtime.modelPlan().rhythm).toEqual({ source: 'basic', reason });
    expect(await runtime.classifyRhythm(features)).toEqual({ source: 'basic', value: null, reason });
  });

  it('uses basic analysis when the shipped file is not bundled', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry()] }, {});
    expect(runtime.modelPlan().rhythm).toEqual({
      source: 'basic',
      reason: 'rhythm-lgbm@1.0.0.onnx is not bundled with the app',
    });
  });
});

describe('role', () => {
  it.each([
    ['missing', undefined],
    ['invalid', 'primary'],
  ])('refuses a shipped model whose role is %s', async (_, role) => {
    const runtime = await loadRuntime({ models: [rhythmEntry({ role }), sqiEntry({ role })] });
    const plan = runtime.modelPlan();
    expect(plan.rhythm).toEqual({
      source: 'basic',
      reason: `refused the shipped rhythm model: rhythm-lgbm@1.0.0 has role ${JSON.stringify(role)}, not "gate" or "guard"`,
    });
    expect(plan.sqi.source).toBe('basic');
    expect((await runtime.sqiVeto(windowAt(-3))).veto).toBe(false);
  });

  it('refuses an SQI model shipped as a gate', async () => {
    const runtime = await loadRuntime({ models: [sqiEntry({ role: 'gate' })] });
    expect(runtime.modelPlan().sqi).toEqual({
      source: 'basic',
      reason:
        'refused the shipped sqi model: sqi-finger@1.0.0 has role "gate", but sqi models must be "guard"',
    });
  });

  it('refuses a guard without a numeric threshold for its label', async () => {
    const runtime = await loadRuntime({ models: [sqiEntry({ threshold: { clean: null } })] });
    expect(runtime.modelPlan().sqi.source).toBe('basic');
  });
});

describe('loading', () => {
  it('falls back when the file does not match its sha256', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry({ sha256: 'a'.repeat(64) })] });
    const outcome = await runtime.classifyRhythm(features);
    expect(outcome).toMatchObject({ source: 'basic', value: null });
    expect(outcome.source === 'basic' && outcome.reason).toMatch(
      /^rhythm-lgbm@1\.0\.0 did not load: sha256 [0-9a-f]{64} does not match the manifest's a{64}$/,
    );
    expect(mockSessionsCreated.count).toBe(0);
  });

  it('falls back when ONNX Runtime fails to install', async () => {
    // The runtime imports the package on first use, outside any isolated registry, so the registry is reset
    // for this test and the working double put back after it.
    jest.resetModules();
    jest.doMock('onnxruntime-react-native', () => {
      throw new TypeError("Cannot read property 'install' of null");
    });
    const runtime = await loadRuntime({ models: [rhythmEntry()] });
    const outcome = await runtime.classifyRhythm(features);
    jest.resetModules();
    jest.doMock('onnxruntime-react-native', () => mockOnnxRuntime());
    expect(outcome).toEqual({
      source: 'basic',
      value: null,
      reason: "rhythm-lgbm@1.0.0 did not load: Cannot read property 'install' of null",
    });
  });

  it('falls back when the model inputs differ from the manifest', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry({ inputs: { x: [1, 8] } })] });
    expect(await runtime.classifyRhythm({ x: features.features })).toEqual({
      source: 'basic',
      value: null,
      reason: "rhythm-lgbm@1.0.0 did not load: model inputs features differ from the manifest's x",
    });
  });

  it('creates each session once, on first use, from a documents-directory copy', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry()] });
    expect(mockSessionsCreated.count).toBe(0);
    await Promise.all([runtime.classifyRhythm(features), runtime.classifyRhythm(features)]);
    await runtime.classifyRhythm(features);
    expect(mockSessionsCreated.count).toBe(1);
    const copy = path.join(mockDocuments, 'models', rhythmFile);
    expect(createHash('sha256').update(fs.readFileSync(copy)).digest('hex')).toBe(rhythmEntry().sha256);
  });
});

describe('running', () => {
  it('reads the LightGBM zipmap=False outputs by their manifest names', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry()] });
    const outcome = await runtime.classifyRhythm(features);
    if (outcome.source !== 'model') throw new Error(outcome.reason);
    expect(outcome.model).toEqual({ name: 'rhythm-lgbm', version: '1.0.0', role: 'gate' });
    // `label` is int64 (a BigInt64Array from ONNX Runtime) and comes back as plain numbers.
    expect(outcome.outputs.label).toEqual([expectedRhythm.label]);
    const [sinus, af, other] = expectedRhythm.probabilities as [number, number, number];
    expect(outcome.scores.sinus).toBeCloseTo(sinus, 5);
    expect(outcome.scores.af).toBeCloseTo(af, 5);
    expect(outcome.scores.other).toBeCloseTo(other, 5);
    expect(outcome.outputs.probabilities).toEqual([
      outcome.scores.sinus,
      outcome.scores.af,
      outcome.scores.other,
    ]);
    expect(outcome.threshold).toEqual({ af: 0.5 });
    expect(outcome.abstainBelow).toBe(0.6);
  });

  it('reads a renamed probability output too', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry({ outputs: { probabilities: [1, 3] } })] });
    const outcome = await runtime.classifyRhythm(features);
    expect(outcome.source === 'model' && Object.keys(outcome.outputs)).toEqual(['probabilities']);
  });

  it.each([
    [
      'a wrong shape',
      { features: { values: new Float32Array(7), dims: [1, 7] } },
      'features is [1, 7], the manifest says [1, 8]',
    ],
    [
      'too few values',
      { features: { values: new Float32Array(7), dims: [1, 8] } },
      'features has 7 values, [1, 8] needs 8',
    ],
    ['a missing input', {}, 'no features input'],
  ])('falls back on %s before running', async (_, feeds, mismatch) => {
    const runtime = await loadRuntime({ models: [rhythmEntry()] });
    expect(await runtime.classifyRhythm(feeds)).toEqual({
      source: 'basic',
      value: null,
      reason: `rhythm-lgbm@1.0.0 input check failed: ${mismatch}`,
    });
    expect(mockSessionsCreated.count).toBe(0);
  });

  it('falls back for one call when inference takes longer than 50 ms', async () => {
    const slow = sqiEntry({ sha256: fixtureSha256('sqi-slow-fixture.onnx') });
    const runtime = await loadRuntime({ models: [slow] }, { [sqiFile]: 'sqi-slow-fixture.onnx' });
    const outcome = await runtime.sqiVeto(windowAt(-3));
    expect(outcome).toMatchObject({ source: 'basic', value: null, veto: false });
    expect(outcome.source === 'basic' && outcome.reason).toMatch(
      /^sqi-finger@1\.0\.0 failed this run: inference took (\d+ ms, )?longer than 50 ms$/,
    );
  }, 30_000);

  it('scores the diabetes pattern from its three inputs', async () => {
    const runtime = await loadRuntime({ models: [diabetesEntry()] });
    const outcome = await runtime.scoreDiabetesPattern({
      beat: { values: new Float32Array(256).fill(1), dims: [1, 1, 256] },
      shapeFeatures: { values: new Float32Array(12).fill(0.5), dims: [1, 12] },
      hrSummary: { values: new Float32Array(4).fill(-0.5), dims: [1, 4] },
    });
    if (outcome.source !== 'model') throw new Error(outcome.reason);
    expect(outcome.scores.pattern).toBeCloseTo(1 / (1 + Math.exp(-1)), 6);
  });
});

describe('rhythm feature width (ADR 0079)', () => {
  const wide = Float32Array.from([
    ...expectedRhythm.features,
    ...Array.from({ length: 7 }, (_, i) => 100 + i),
  ]);
  const wideFeed = { features: { values: wide, dims: [1, 15] } };

  it('sends only the first 8 of 15-wide windows to a v1 manifest', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry()] });
    const outcome = await runtime.classifyRhythm(wideFeed);
    if (outcome.source !== 'model') throw new Error(outcome.reason);
    const [sinus, af, other] = expectedRhythm.probabilities as [number, number, number];
    expect(outcome.scores.sinus).toBeCloseTo(sinus, 5);
    expect(outcome.scores.af).toBeCloseTo(af, 5);
    expect(outcome.scores.other).toBeCloseTo(other, 5);
  });

  it('refuses 8-wide windows for a v2 [1, 15] manifest, with the reason', async () => {
    const runtime = await loadRuntime({ models: [rhythmEntry({ inputs: { features: [1, 15] } })] });
    expect(await runtime.classifyRhythm(features)).toEqual({
      source: 'basic',
      value: null,
      reason: 'rhythm-lgbm@1.0.0 input check failed: features is [1, 8], the manifest says [1, 15]',
    });
    expect(mockSessionsCreated.count).toBe(0);
  });

  const reordered: string[] = [...RHYTHM_FEATURE_NAMES.slice(0, 8)];
  [reordered[0], reordered[1]] = [reordered[1] as string, reordered[0] as string];

  it.each([
    ['reordered names', reordered],
    ['too few names', RHYTHM_FEATURE_NAMES.slice(0, 7)],
    ['no names', undefined],
    ['a hole where a name belongs', holed(RHYTHM_FEATURE_NAMES.slice(0, 8))],
    ['its own some() that hides a reordering', ownSome(reordered)],
  ])('refuses a v1 manifest with %s in featureOrder', async (_, featureOrder) => {
    const runtime = await loadRuntime({ models: [rhythmEntry({ featureOrder })] });
    const plan = runtime.modelPlan().rhythm;
    expect(plan.source === 'basic' && plan.reason).toMatch(
      /^refused the shipped rhythm model: rhythm-lgbm@1\.0\.0 cannot be fed its features: its featureOrder /,
    );
    expect(await runtime.classifyRhythm(features)).toMatchObject({ source: 'basic', value: null });
    expect(mockSessionsCreated.count).toBe(0);
  });

  it('refuses a v2 manifest whose tail names are reordered', async () => {
    const tailSwapped: string[] = [...RHYTHM_FEATURE_NAMES];
    [tailSwapped[13], tailSwapped[14]] = [tailSwapped[14] as string, tailSwapped[13] as string];
    const runtime = await loadRuntime({
      models: [rhythmEntry({ inputs: { features: [1, 15] }, featureOrder: tailSwapped })],
    });
    expect(runtime.modelPlan().rhythm.source).toBe('basic');
  });

  // No width-15 ONNX fixture exists, so this checks the tensors the runtime builds and hands to the session,
  // using a recording session in place of ONNX Runtime; it says nothing about how a v2 model scores.
  it('sends all 15 values of 15-wide windows to a v2 [1, 15] manifest', async () => {
    const tensorsRun: { dims: readonly number[]; values: number[] }[] = [];
    jest.resetModules();
    jest.doMock('onnxruntime-react-native', () => ({
      Tensor: function Tensor(_: 'float32', values: Float32Array, dims: number[]) {
        return { values, dims };
      },
      InferenceSession: {
        create: async () => ({
          inputNames: ['features'],
          outputNames: ['label', 'probabilities'],
          run: async (feeds: Record<string, { values: Float32Array; dims: number[] }>) => {
            const sent = feeds.features as { values: Float32Array; dims: number[] };
            tensorsRun.push({ dims: sent.dims, values: Array.from(sent.values) });
            // The runtime reads a tensor's numbers from its `data` field, which the style lint reserves.
            return {
              label: { type: 'int64', ['data']: BigInt64Array.from([0n]) },
              probabilities: { type: 'float32', ['data']: Float32Array.from([0.2, 0.3, 0.5]) },
            };
          },
        }),
      },
    }));
    const runtime = await loadRuntime({ models: [rhythmEntry({ inputs: { features: [1, 15] } })] });
    const outcome = await runtime.classifyRhythm(wideFeed);
    jest.resetModules();
    jest.doMock('onnxruntime-react-native', () => mockOnnxRuntime());
    if (outcome.source !== 'model') throw new Error(outcome.reason);
    const lastRun = tensorsRun[tensorsRun.length - 1];
    expect(lastRun?.dims).toEqual([1, 15]);
    expect(lastRun?.values).toEqual(Array.from(wide));
  });
});

describe('diabetes inputs with missing values', () => {
  const beat = new Float64Array(256).fill(0.25);
  const shapeFeatures = (value: number | null) =>
    shapeFeatureNames.map((_, index) => (index % 2 ? value : 0.3));
  const hrSummary = (value: number | null) => hrSummaryNames.map((_, index) => (index % 2 ? 0.2 : value));
  const scoreOf = async (input: Parameters<typeof Runtime.scoreDiabetesInput>[0]) => {
    const runtime = await loadRuntime({ models: [diabetesEntry()] });
    const outcome = await runtime.scoreDiabetesInput(input);
    if (outcome.source !== 'model') throw new Error(outcome.reason);
    return outcome.scores.pattern as number;
  };

  it("fills each null with the manifest's training median for that feature", async () => {
    const medianAt = (names: string[], index: number) => fillMedians[names[index] as string] as number;
    const filledByHand = {
      beat,
      shapeFeatures: shapeFeatures(null).map((value, index) => value ?? medianAt(shapeFeatureNames, index)),
      hrSummary: hrSummary(null).map((value, index) => value ?? medianAt(hrSummaryNames, index)),
    };
    const withNulls = { beat, shapeFeatures: shapeFeatures(null), hrSummary: hrSummary(null) };
    const zeroFilled = { beat, shapeFeatures: shapeFeatures(0), hrSummary: hrSummary(0) };
    const scoreWithNulls = await scoreOf(withNulls);
    expect(scoreWithNulls).toBeCloseTo(await scoreOf(filledByHand), 6);
    expect(scoreWithNulls).not.toBeCloseTo(await scoreOf(zeroFilled), 3);
  });

  it('keeps the values it was given', async () => {
    const given = { beat, shapeFeatures: shapeFeatures(0.9), hrSummary: hrSummary(0.9) };
    const medianOnly = { beat, shapeFeatures: shapeFeatures(null), hrSummary: hrSummary(null) };
    expect(await scoreOf(given)).not.toBeCloseTo(await scoreOf(medianOnly), 3);
  });

  it.each([
    ['no fillMedians', { fillMedians: undefined }, 'it has no featureOrder or fillMedians'],
    [
      'a feature without a median',
      { fillMedians: { ...fillMedians, hrBpm: undefined } },
      'its fillMedians has no finite median for every hrSummary feature',
    ],
    [
      'a reordered shapeFeatures list',
      {
        featureOrder: {
          shapeFeatures: [...shapeFeatureNames.slice(1), shapeFeatureNames[0]],
          hrSummary: hrSummaryNames,
        },
      },
      `its featureOrder.shapeFeatures is not core's order: ${shapeFeatureNames.join(', ')}`,
    ],
    [
      'a reordered hrSummary list',
      {
        featureOrder: {
          shapeFeatures: shapeFeatureNames,
          hrSummary: [...hrSummaryNames.slice(1), hrSummaryNames[0]],
        },
      },
      `its featureOrder.hrSummary is not core's order: ${hrSummaryNames.join(', ')}`,
    ],
    [
      'a hole in the shapeFeatures list',
      { featureOrder: { shapeFeatures: holed(shapeFeatureNames), hrSummary: hrSummaryNames } },
      `its featureOrder.shapeFeatures is not core's order: ${shapeFeatureNames.join(', ')}`,
    ],
    [
      'an hrSummary list whose own some() hides a reordering',
      {
        featureOrder: {
          shapeFeatures: shapeFeatureNames,
          hrSummary: ownSome([...hrSummaryNames.slice(1), hrSummaryNames[0] as string]),
        },
      },
      `its featureOrder.hrSummary is not core's order: ${hrSummaryNames.join(', ')}`,
    ],
    [
      'a featureOrder of the wrong length',
      { featureOrder: { shapeFeatures: shapeFeatureNames.slice(1), hrSummary: hrSummaryNames } },
      'its featureOrder.shapeFeatures does not list the 12 features of that input',
    ],
  ])('refuses a diabetes model with %s', async (_, changes, why) => {
    const runtime = await loadRuntime({ models: [diabetesEntry(changes)] });
    const reason = `refused the shipped diabetes model: diabetes-net@1.0.0 cannot be fed a missing value: ${why}`;
    expect(runtime.modelPlan().diabetes).toEqual({ source: 'basic', reason });
    expect(
      await runtime.scoreDiabetesInput({
        beat,
        shapeFeatures: shapeFeatures(null),
        hrSummary: hrSummary(null),
      }),
    ).toEqual({ source: 'basic', value: null, reason });
  });
});

describe('SQI guard', () => {
  it('only ever vetoes: a low P(clean) rejects, a high one adds nothing', async () => {
    const runtime = await loadRuntime({ models: [sqiEntry()] });
    const lowScore = await runtime.sqiVeto(windowAt(-3));
    const highScore = await runtime.sqiVeto(windowAt(3));
    expect(lowScore).toEqual({
      source: 'model',
      model: { name: 'sqi-finger', version: '1.0.0', role: 'guard' },
      veto: true,
    });
    expect(highScore).toMatchObject({ source: 'model', veto: false });
    // No P(clean) or "accept" field reaches the caller, so the guard can't be used to accept a window.
    expect(Object.keys(highScore).sort()).toEqual(['model', 'source', 'veto']);
  });

  it('treats a NaN P(clean) as a failed run, not as a pass', async () => {
    const runtime = await loadRuntime({ models: [sqiEntry()] });
    expect(await runtime.sqiVeto(windowAt(Number.NaN))).toEqual({
      source: 'basic',
      value: null,
      reason: 'sqi-finger@1.0.0 failed this run: pClean has a non-finite score',
      veto: false,
    });
  });
});

describe('the models the app ships', () => {
  const appModels = path.join(path.dirname(path.dirname(path.dirname(fixtures))), 'assets', 'models');
  const shippedFiles = Object.fromEntries(
    [rhythmFile, sqiFile, diabetesFile].map((file): [string, string] => [file, file]),
  );
  const appManifest = JSON.parse(
    new TextDecoder().decode(fs.readFileSync(path.join(appModels, 'manifest.json'))),
  );

  it('load from the synced manifest and files, one per family', async () => {
    const runtime = await loadRuntime(appManifest, shippedFiles, appModels);
    expect(Object.values(runtime.modelPlan()).map((plan) => plan.source)).toEqual([
      'model',
      'model',
      'model',
    ]);
    expect(await runtime.classifyRhythm(features)).toMatchObject({ source: 'model' });
  });

  it('give the SQI cut-off from the manifest, so SQI-Net can count as having run', async () => {
    const runtime = await loadRuntime(appManifest, shippedFiles, appModels);
    const sqi = appManifest.models.find((entry: { name: string }) => entry.name === 'sqi-finger');
    expect(runtime.sqiThreshold()).toBe(sqi.threshold.clean);
    expect(await runtime.scoreSqiWindow(new Float32Array(256))).toMatchObject({ source: 'model' });
  });

  it('hand out the rule-only rhythm entry and never plan it as a model', async () => {
    const runtime = await loadRuntime(appManifest, shippedFiles, appModels);
    expect(runtime.rhythmRuleEntry()).toMatchObject({ name: 'rhythm-logistic', ships: false });
    expect(runtime.modelPlan().rhythm).toMatchObject({ name: 'rhythm-lgbm' });
  });
});

describe('the rule entry', () => {
  it('is null without a manifest', async () => {
    expect((await loadRuntime(null, {})).rhythmRuleEntry()).toBeNull();
  });

  it('is null when no unshipped rhythm entry has a rule', async () => {
    const runtime = await loadRuntime({
      models: [rhythmEntry(), rhythmEntry({ ships: false, name: 'rhythm-net' })],
    });
    expect(runtime.rhythmRuleEntry()).toBeNull();
  });

  it('is found even while the rhythm model works', async () => {
    const rule = rhythmEntry({ name: 'rhythm-logistic', ships: false, rule: { classes: [] } });
    const runtime = await loadRuntime({ models: [rhythmEntry(), rule] });
    expect(runtime.rhythmRuleEntry()).toBe(rule);
  });
});
