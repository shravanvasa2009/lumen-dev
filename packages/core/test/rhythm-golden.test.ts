import { hasEnoughUsableIntervals, rhythmFeatureVector, rhythmWindows, type RhythmWindow } from '../src';
import rhythmGolden from './golden/rhythm.json';

// §10.2: rhythm features match ml/lumen_dsp (python -m lumen_dsp.golden_rhythm) within 1e-4 relative.
// An expected 0 must be exactly 0; window positions, intervals, flags, and nulls must match exactly.
// The Rhythm-Net feature vector (8 values, sample entropy filled per ADR 0024) is held to the same rule.
const RELATIVE_TOLERANCE = 1e-4;
const FEATURES = [
  'normalizedRmssd',
  'shannonEntropyBits',
  'turningPointRatio',
  'sd1S',
  'sd2S',
  'pnn50',
  'sampleEntropy',
  'atypicalFraction',
] as const;

function expectFeature(actual: number | null, expected: number | null) {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(RELATIVE_TOLERANCE * Math.abs(expected));
}

describe('DSP-C golden parity: DSP-15 rhythm features', () => {
  it.each(rhythmGolden.cases)('$name', ({ intervalsS, spansArtifact, atypicalBeats, expected }) => {
    expect(hasEnoughUsableIntervals(spansArtifact)).toBe(expected.hasEnoughUsableIntervals);
    const windows: RhythmWindow[] = rhythmWindows(intervalsS, spansArtifact, atypicalBeats);
    expect(windows.map((window) => window.startInterval)).toEqual(
      expected.windows.map((window) => window.startInterval),
    );
    windows.forEach((window, i) => {
      const golden = expected.windows[i]!;
      expect(window.intervalsS).toEqual(golden.intervalsS);
      for (const feature of FEATURES) expectFeature(window[feature], golden[feature]);
      const vector = rhythmFeatureVector(window);
      expect(vector).toHaveLength(golden.featureVector.length);
      vector.forEach((value, k) => expectFeature(value, golden.featureVector[k]!));
    });
  });
});
