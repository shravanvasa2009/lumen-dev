import { buildTimebase, fingerSignals } from '../src';
import { captureAt, regularOffsets } from './synthetic';

describe('DSP-3 finger raw signal', () => {
  it('uses inverted red as the primary signal and inverted green as the secondary', () => {
    const { samples, stats } = captureAt(regularOffsets(30, 1), (tS) => ({
      r: 0.6 + 0.01 * tS,
      g: 0.12 - 0.01 * tS,
      b: 0.05,
    }));
    const timebase = buildTimebase(samples, stats);
    const signals = fingerSignals(timebase);
    expect(Array.from(signals.primary)).toEqual(Array.from(timebase.r, (red) => -red));
    expect(Array.from(signals.secondary)).toEqual(Array.from(timebase.g, (green) => -green));
  });
});
