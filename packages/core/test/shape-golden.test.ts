import { ensembleBeat } from '../src';
import shapeGolden from './golden/shape.json';

// DSP-14 against python -m lumen_dsp.golden. The averaged beat (diabetes-net's input) is built with the
// same operations in the same order, so it must match exactly. Savitzky–Golay differs only in method
// (core: normal equations; scipy: lstsq and polyfit): observed ≤ 1.8e-15; 1e-12 leaves room for other
// machines. Wave labels and beat counts must match exactly.
const SAVGOL_TOLERANCE = 1e-12;

function maxAbsDifference(actual: ArrayLike<number>, expected: number[]): number {
  expect(actual).toHaveLength(expected.length);
  return expected.reduce((worst, value, i) => Math.max(worst, Math.abs(actual[i]! - value)), 0);
}

describe('DSP-C golden parity: DSP-14 ensemble beat', () => {
  it.each(shapeGolden.cases)('$name', ({ onsets, normal, captureFps, expected }) => {
    const shape = ensembleBeat(shapeGolden.signal, onsets, normal, captureFps);
    if (expected === null) {
      expect(shape).toBeNull();
      return;
    }
    expect(shape!.beatsUsed).toBe(expected.beatsUsed);
    expect(Array.from(shape!.beat)).toEqual(expected.beat);
    expect(maxAbsDifference(shape!.smoothed, expected.smoothed)).toBeLessThan(SAVGOL_TOLERANCE);
    expect(maxAbsDifference(shape!.secondDerivative, expected.secondDerivative)).toBeLessThan(
      SAVGOL_TOLERANCE,
    );
    expect(shape!.waves).toEqual(expected.waves);
  });
});
