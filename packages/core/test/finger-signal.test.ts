import { buildTimebase, dcLevel, fingerSignals } from '../src';
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

describe('DSP-3 DC level for the perfusion index', () => {
  it('keeps the baseline and slow drift and removes the pulse', () => {
    const rateHz = 64;
    const baseline = (tS: number) => 0.6 + 0.01 * Math.sin(2 * Math.PI * 0.05 * tS);
    const signal = Float64Array.from({ length: 60 * rateHz }, (_, n) => {
      const tS = n / rateHz;
      return baseline(tS) + 0.006 * Math.sin(2 * Math.PI * 1.2 * tS);
    });
    // Order-2 low-pass at 0.3 Hz, applied forward and backward: the 1.2 Hz pulse keeps
    // |H|² = 1/(1 + 4⁴) ≈ 0.0039 (2.3e-5 of 0.006) and the 0.05 Hz drift loses
    // 1 − 1/(1 + (1/6)⁴) ≈ 7.7e-4 (7.7e-6 of 0.01), so the error stays under 5e-5.
    const dc = dcLevel(signal, rateHz);
    dc.forEach((value, n) => {
      const tS = n / rateHz;
      if (tS >= 10 && tS < 50) expect(Math.abs(value - baseline(tS))).toBeLessThan(5e-5);
    });
  });
});
