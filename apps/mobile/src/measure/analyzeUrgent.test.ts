import type { FrameStat, Sample } from '@lumen/core';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';

import { analyzeKeptCapture } from './analyzeKeptCapture';
import type { KeptCapture } from './keptCapture';

let mockRhythmFails = false;
jest.mock('../ml/runtime', () => ({
  classifyRhythm: async () => {
    if (mockRhythmFails) throw new Error('rhythm model unavailable');
    return { source: 'basic', value: null, reason: 'no model in this test' };
  },
  rhythmRuleEntry: () => null,
  scoreDiabetesInput: async () => ({ source: 'basic', value: null, reason: 'no model in this test' }),
}));

jest.setTimeout(60_000);

const FPS = 60;
const SECONDS = 100;

// SYNTHETIC: a steady pulse in red on a covered lens, like the profile tests use.
function pulseAt(bpm: number): KeptCapture {
  const hz = bpm / 60;
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

const request = { mode: 'full', restTimerDone: true } as const;

beforeEach(() => {
  emptyMockDatabases();
  mockRhythmFails = false;
});

describe('the outcome computed for a capture carries its urgent flags', () => {
  it('flags a sustained fast rate at rest', async () => {
    const analysed = await analyzeKeptCapture(
      pulseAt(170),
      request,
      () => {},
      () => {},
    );
    expect(analysed.urgent).toEqual({ fastSustained: true, slowBelow40: false });
  });

  it('flags a rate under 40', async () => {
    const analysed = await analyzeKeptCapture(
      pulseAt(35),
      request,
      () => {},
      () => {},
    );
    expect(analysed.urgent).toEqual({ fastSustained: false, slowBelow40: true });
  });

  it('flags nothing for an ordinary rate', async () => {
    const analysed = await analyzeKeptCapture(
      pulseAt(70),
      request,
      () => {},
      () => {},
    );
    expect(analysed.urgent).toBeNull();
  });
});

describe('a failure after the outcome keeps the urgent flags', () => {
  it('reports them before the rhythm step throws', async () => {
    mockRhythmFails = true;
    const reported: unknown[] = [];
    await expect(
      analyzeKeptCapture(
        pulseAt(170),
        request,
        () => {},
        (urgent) => reported.push(urgent),
      ),
    ).rejects.toThrow('rhythm model unavailable');
    expect(reported).toEqual([{ fastSustained: true, slowBelow40: false }]);
  });
});
