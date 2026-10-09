import type { FrameStat, Sample } from '@lumen/core';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import type { ScoreOutcome } from '../ml/runtime';

import { analyzeKeptCapture } from './analyzeKeptCapture';
import type { KeptCapture } from './keptCapture';

// A model double: the ONNX runtime is not available in Jest. The median fill itself is tested in
// ml/runtime.test.ts; here the question is what analysis hands to the model and what it does with the answer.
const mockScoreDiabetes = jest.fn<Promise<ScoreOutcome>, [unknown]>();
jest.mock('../ml/runtime', () => ({
  classifyRhythm: async () => ({
    source: 'model',
    scores: { sinus: 0.9, af: 0.05, other: 0.05 },
    threshold: { af: 0.5 },
  }),
  rhythmRuleEntry: () => null,
  scoreDiabetesInput: (input: unknown) => mockScoreDiabetes(input),
}));

jest.setTimeout(60_000);

// Full Scan needs 90 clean seconds (spec 07), so the capture runs longer than the rhythm rules need.
const SECONDS = 100;
const BEATS_PER_MIN = 72;

// SYNTHETIC: a smooth steady pulse in red on a covered lens, long enough for rhythm rules and a pulse shape.
function steadyPulse(fps: number): KeptCapture {
  const hz = BEATS_PER_MIN / 60;
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (let i = 0; i < SECONDS * fps; i += 1) {
    const tNs = 1e12 + (i * 1e9) / fps;
    const phase = (2 * Math.PI * hz * i) / fps;
    samples.push({ tNs, r: 0.7 - 0.012 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase)), g: 0.1, b: 0.1 });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 });
  }
  return { captureFps: fps, lensId: null, samples, stats, motionSpans: [], coldHandsSpans: [], sqi: null };
}

async function analyse(capture: KeptCapture, mode: 'full' | 'quick') {
  const analysed = await analyzeKeptCapture(
    capture,
    { mode, restTimerDone: true },
    () => {},
    () => {},
  );
  if ('kind' in analysed) throw new Error(`the capture was refused: ${analysed.reasons.join(', ')}`);
  return analysed;
}

const modelAnswer: ScoreOutcome = {
  source: 'model',
  model: { name: 'diabetes-net', version: '1.0.0', role: 'gate' },
  scores: { pattern: 0.31 },
  outputs: { pPattern: [0.31] },
  threshold: { pattern: 0.56 },
  abstainBelow: null,
};

beforeEach(() => {
  emptyMockDatabases();
  mockScoreDiabetes.mockReset();
  mockScoreDiabetes.mockResolvedValue(modelAnswer);
});

describe('diabetes model inputs', () => {
  it('gives a Full Scan with a pulse shape to the model in the shapes it takes', async () => {
    const { models } = await analyse(steadyPulse(60), 'full');
    expect(mockScoreDiabetes).toHaveBeenCalledTimes(1);
    const input = mockScoreDiabetes.mock.calls[0]?.[0] as {
      beat: Float64Array;
      shapeFeatures: unknown[];
      hrSummary: unknown[];
    };
    expect(input.beat).toBeInstanceOf(Float64Array);
    expect(input.beat).toHaveLength(256);
    expect(input.shapeFeatures).toHaveLength(12);
    expect(input.hrSummary).toHaveLength(4);
    // The heart rate is the first hrSummary value, from the same reading the screen shows.
    expect(input.hrSummary[0]).toBeCloseTo(BEATS_PER_MIN, -1);
    expect(models.diabetes).toEqual({ probability: 0.31, tauDm: 0.56 });
  });

  it('scores the lower-quality beat below 60 fps, and the result is tagged (ADR 0104)', async () => {
    const { models, reading } = await analyse(steadyPulse(30), 'full');
    expect(mockScoreDiabetes).toHaveBeenCalledTimes(1);
    expect(models.diabetes).toEqual({ probability: 0.31, tauDm: 0.56 });
    expect(reading.metrics.diabetes).toMatchObject({ quality: 'low', flag: null });
    expect(reading.metrics.diabetes!.qualityReasons).toContain('lowFps');
  });

  it('leaves diabetes out when the model gave basic analysis', async () => {
    mockScoreDiabetes.mockResolvedValue({ source: 'basic', value: null, reason: 'no model' });
    const { models } = await analyse(steadyPulse(60), 'full');
    expect(models.diabetes).toBeNull();
  });

  // A Full Scan is a floor of the diabetes pattern alone (§11.4), so a Quick value is tagged for it (owner answer 4).
  it('runs the model for a Quick Check too, tagged quickMode (owner, ADR 0104)', async () => {
    const { models, reading } = await analyse(steadyPulse(60), 'quick');
    expect(mockScoreDiabetes).toHaveBeenCalledTimes(1);
    expect(models.diabetes).toEqual({ probability: 0.31, tauDm: 0.56 });
    expect(reading.metrics.diabetes!.qualityReasons).toContain('quickMode');
  });
});
