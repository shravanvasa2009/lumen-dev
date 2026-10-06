import { logisticRhythmOutputs, type FrameStat, type Sample } from '@lumen/core';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import manifest from '../../assets/models/manifest.json';

import { analyzeKeptCapture } from './analyzeKeptCapture';
import type { KeptCapture } from './keptCapture';

jest.mock('@lumen/core', () => {
  const core = jest.requireActual<typeof import('@lumen/core')>('@lumen/core');
  return { ...core, logisticRhythmOutputs: jest.fn(core.logisticRhythmOutputs) };
});

// The ONNX runtime is not available in Jest. mockRhythm answers each window in turn; the rule entry is the
// real rhythm-logistic entry from the synced app manifest.
type RhythmAnswer = 'basic' | 'model' | 'bad-row';
let mockRuleEntry: unknown = null;
let mockRhythm: (call: number) => RhythmAnswer = () => 'basic';
let mockCalls = 0;
jest.mock('../ml/runtime', () => ({
  classifyRhythm: async () => {
    const answer = mockRhythm(mockCalls++);
    if (answer === 'basic') return { source: 'basic', value: null, reason: 'no model in this test' };
    const scores =
      answer === 'model' ? { sinus: 0.9, af: 0.05, other: 0.05 } : { sinus: 0.9, af: 0.5, other: 0.5 };
    return { source: 'model', scores, threshold: { af: 0.5 } };
  },
  rhythmRuleEntry: () => mockRuleEntry,
  scoreDiabetesInput: async () => ({ source: 'basic', value: null, reason: 'no model in this test' }),
}));

jest.setTimeout(60_000);

const FPS = 60;
const SECONDS = 100;

// SYNTHETIC: a steady pulse in red on a covered lens.
function steadyPulse(): KeptCapture {
  const hz = 72 / 60;
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (let i = 0; i < SECONDS * FPS; i += 1) {
    const tNs = 1e12 + (i * 1e9) / FPS;
    const phase = (2 * Math.PI * hz * i) / FPS;
    samples.push({ tNs, r: 0.7 - 0.012 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase)), g: 0.1, b: 0.1 });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 });
  }
  return { captureFps: FPS, lensId: null, samples, stats, motionSpans: [], coldHandsSpans: [], sqi: null };
}

async function analyse() {
  const analysed = await analyzeKeptCapture(
    steadyPulse(),
    { mode: 'quick', restTimerDone: true },
    () => {},
    () => {},
  );
  if ('kind' in analysed) throw new Error(`the capture was refused: ${analysed.reasons.join(', ')}`);
  return analysed;
}

const ruleEntry = manifest.models.find((entry) => entry.name === 'rhythm-logistic');

beforeEach(() => {
  emptyMockDatabases();
  mockRuleEntry = ruleEntry;
  mockRhythm = () => 'basic';
  mockCalls = 0;
  jest.mocked(logisticRhythmOutputs).mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('rhythm when the model cannot run', () => {
  it('scores every window with the rhythm-logistic rule and says so', async () => {
    const { models } = await analyse();
    expect(models.rhythm?.scorer).toBe('rule');
    expect(models.rhythm?.tauAf).toBe(ruleEntry?.threshold.af);
    expect(models.rhythm?.windowProbs.length).toBeGreaterThan(1);
    for (const row of models.rhythm?.windowProbs ?? [])
      expect(row.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 6);
  });

  it('leaves the reading without a rhythm output when the manifest has no rule', async () => {
    mockRuleEntry = null;
    const { models } = await analyse();
    expect(models.rhythm).toBeNull();
  });

  it('records the model as the scorer when it scored every window', async () => {
    mockRhythm = () => 'model';
    const { models } = await analyse();
    expect(models.rhythm).toMatchObject({ scorer: 'model', tauAf: 0.5 });
    expect(logisticRhythmOutputs).not.toHaveBeenCalled();
  });

  it('is the same rule output whether the model failed on the first window or after scoring some', async () => {
    const fromStart = (await analyse()).models.rhythm;
    mockCalls = 0;
    mockRhythm = (call) => (call < 2 ? 'model' : 'basic');
    const afterSome = (await analyse()).models.rhythm;
    expect(afterSome).toEqual(fromStart);
    // None of the 0.9 / 0.05 / 0.05 rows the model gave may be left in the reading.
    expect(afterSome?.windowProbs.some(([sinus]) => sinus === 0.9)).toBe(false);
    expect(afterSome?.tauAf).toBe(ruleEntry?.threshold.af);
  });

  it('uses the rule for every window when the model gives a row that is not a probability row', async () => {
    const fromStart = (await analyse()).models.rhythm;
    mockCalls = 0;
    mockRhythm = (call) => (call < 2 ? 'model' : 'bad-row');
    const { models } = await analyse();
    expect(models.rhythm).toEqual(fromStart);
    expect(models.rhythm?.scorer).toBe('rule');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not a probability row'));
  });

  it('reports a window the rule cannot score and leaves the reading without a rhythm output', async () => {
    jest.mocked(logisticRhythmOutputs).mockImplementationOnce(() => {
      throw new RangeError('a feature vector overflows the rule logits to a non-finite number');
    });
    const { models } = await analyse();
    expect(models.rhythm).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('overflows'));
  });

  it('lets a broken rule entry fail the analysis', async () => {
    jest.mocked(logisticRhythmOutputs).mockImplementationOnce(() => {
      throw new Error('the entry has no rule');
    });
    await expect(analyse()).rejects.toThrow('the entry has no rule');
  });
});
