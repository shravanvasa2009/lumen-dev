import { buildReadingResult, type FrameStat, type Sample } from '@lumen/core';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { saveHealthNote } from '@/store/profile';

import { analyzeKeptCapture } from './analyzeKeptCapture';
import type { KeptCapture } from './keptCapture';

// A model double: the ONNX runtime is not available in Jest, and without a model the reading has no rhythm
// card whatever the profile says, which would make the pacemaker case pass for the wrong reason.
jest.mock('@lumen/core', () => {
  const core = jest.requireActual<typeof import('@lumen/core')>('@lumen/core');
  return { ...core, buildReadingResult: jest.fn(core.buildReadingResult) };
});

let mockRhythmScores = { sinus: 0.9, af: 0.05, other: 0.05 };
jest.mock('../ml/runtime', () => ({
  classifyRhythm: async () => ({
    source: 'model',
    scores: mockRhythmScores,
    threshold: { af: 0.5 },
  }),
}));

jest.setTimeout(60_000);

const FPS = 60;
const SECONDS = 70;
const BEATS_PER_MIN = 45;

// SYNTHETIC: a smooth steady pulse at 45 beats/min in red on a covered lens, long enough for rhythm rules.
function slowPulse(): KeptCapture {
  const hz = BEATS_PER_MIN / 60;
  const frames = SECONDS * FPS;
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (let i = 0; i < frames; i += 1) {
    const tNs = 1e12 + (i * 1e9) / FPS;
    const phase = (2 * Math.PI * hz * i) / FPS;
    samples.push({ tNs, r: 0.7 - 0.012 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase)), g: 0.1, b: 0.1 });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 });
  }
  return { captureFps: FPS, samples, stats, motionSpans: [], coldHandsSpans: [], sqi: null };
}

const analyse = () => analyzeKeptCapture(slowPulse(), { mode: 'full', restTimerDone: true }, () => {});

beforeEach(() => {
  emptyMockDatabases();
  mockRhythmScores = { sinus: 0.9, af: 0.05, other: 0.05 };
});

describe('analysis reads the saved profile', () => {
  it('flags a slow resting rate and screens rhythm when no condition is saved', async () => {
    const { reading } = await analyse();
    expect(reading.metrics.hr?.value).toBeCloseTo(BEATS_PER_MIN, -1);
    expect(reading.metrics.hr?.flag).toBe('slowResting');
    expect(reading.metrics.rhythm).not.toBeNull();
  });

  it('does not flag 45 beats/min for someone on a beta-blocker', async () => {
    await saveHealthNote('betaBlocker', true);
    const { reading } = await analyse();
    expect(reading.metrics.hr?.flag).toBeNull();
  });

  it('does not flag 45 beats/min for an endurance athlete', async () => {
    await saveHealthNote('athlete', true);
    const { reading } = await analyse();
    expect(reading.metrics.hr?.flag).toBeNull();
  });

  it('turns rhythm screening off with a pacemaker', async () => {
    await saveHealthNote('pacemaker', true);
    const { reading } = await analyse();
    expect(reading.metrics.rhythm).toBeNull();
  });

  // Through this pipeline the reading's confidence is capped at moderate (no SQI scores, no rated tier), and
  // core only raises the rhythm flag at high confidence, so the flag itself is core's test. What is checked
  // here is that the saved answer reaches core, which then reports AF as tracked, not flagged.
  it('hands a known-AF answer to the decision rules, which then raise no rhythm flag', async () => {
    mockRhythmScores = { sinus: 0.02, af: 0.96, other: 0.02 };
    await saveHealthNote('knownAf', true);
    const { reading } = await analyse();
    expect(buildReadingResult).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { athlete: false, betaBlocker: false, pacemaker: false, knownAf: true },
      [],
    );
    expect(reading.metrics.rhythm?.class).toBe('af');
    expect(reading.metrics.rhythm?.flag).toBeNull();
  });
});
