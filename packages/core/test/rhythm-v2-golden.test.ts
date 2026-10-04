import { rhythmV2Features, rhythmWindows } from '../src';
import v2Golden from './golden/rhythm-v2.json';

// §10.2: the rhythm v2 features (ADR 0079) match ml/lumen_dsp (python -m lumen_dsp.golden) within
// 1e-4 relative, and an expected 0 must be exactly 0, as for the v1 rhythm features.
const RELATIVE_TOLERANCE = 1e-4;

describe('DSP-C golden parity: DSP-15 rhythm v2 features', () => {
  it.each(v2Golden.cases)('$name', ({ intervalsS, spansArtifact, atypicalBeats, expected }) => {
    const windows = rhythmWindows(intervalsS, spansArtifact, atypicalBeats);
    expect(windows.map((window) => window.startInterval)).toEqual(
      expected.windows.map((window) => window.startInterval),
    );
    windows.forEach((window, i) => {
      const golden = expected.windows[i]!.v2Features;
      const features = rhythmV2Features(window);
      expect(features).toHaveLength(golden.length);
      features.forEach((value, k) => {
        expect(Math.abs(value - golden[k]!)).toBeLessThanOrEqual(RELATIVE_TOLERANCE * Math.abs(golden[k]!));
      });
    });
  });
});
