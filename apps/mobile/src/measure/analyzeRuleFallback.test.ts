import type { FrameStat, Sample } from '@lumen/core';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import manifest from '../../assets/models/manifest.json';

import { analyzeKeptCapture } from './analyzeKeptCapture';
import type { KeptCapture } from './keptCapture';

// The ONNX runtime is not available in Jest, so the rhythm model here always gives basic analysis; the rule
// entry is the real rhythm-logistic entry from the synced app manifest.
let mockRuleEntry: unknown = null;
jest.mock('../ml/runtime', () => ({
  classifyRhythm: async () => ({ source: 'basic', value: null, reason: 'no model in this test' }),
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

beforeEach(() => {
  emptyMockDatabases();
});

describe('rhythm when the model cannot run', () => {
  it('scores every window with the rhythm-logistic rule', async () => {
    mockRuleEntry = manifest.models.find((entry) => entry.name === 'rhythm-logistic');
    const { models } = await analyse();
    expect(models.rhythm).not.toBeNull();
    expect(models.rhythm?.tauAf).toBe(manifest.models.find((entry) => entry.name === 'rhythm-logistic')?.threshold.af);
    expect(models.rhythm?.windowProbs.length).toBeGreaterThan(0);
    for (const row of models.rhythm?.windowProbs ?? [])
      expect(row.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 6);
  });

  it('leaves the reading without a rhythm output when the manifest has no rule', async () => {
    mockRuleEntry = null;
    const { models } = await analyse();
    expect(models.rhythm).toBeNull();
  });
});
