import { buildTimebase, dcLevel, DSP_CONFIG, fingerSignals, sqiModelInput, zScoreWindow } from '../src';
import { captureAt } from './synthetic';

describe('DSP-3 finger raw signal', () => {
  it('uses inverted red as the primary signal and inverted green as the secondary', () => {
    const red = [0.6, 0.65, 0.7];
    const green = [0.12, 0.1, 0.08];
    const { samples, stats } = captureAt([0, 1 / 30, 2 / 30], (tS) => {
      const frame = Math.round(tS * 30);
      return { r: red[frame]!, g: green[frame]!, b: 0.05 };
    });
    const signals = fingerSignals(buildTimebase(samples, stats));
    expect(Array.from(signals.primary)).toEqual([-0.6, -0.65, -0.7]);
    expect(Array.from(signals.secondary)).toEqual([-0.12, -0.1, -0.08]);
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

describe('DSP-3 per-window z-score for model inputs', () => {
  it('uses 4 s windows: 256 samples at 64 Hz', () => {
    expect(DSP_CONFIG.dsp3.modelWindowS * DSP_CONFIG.dsp2.modelRateHz).toBe(256);
  });

  it('subtracts the mean and divides by the population SD (divide by n)', () => {
    // Mean 2.5; population variance (2.25 + 0.25 + 0.25 + 2.25) / 4 = 1.25.
    const scored = zScoreWindow([1, 2, 3, 4])!;
    const sd = Math.sqrt(1.25);
    [-1.5 / sd, -0.5 / sd, 0.5 / sd, 1.5 / sd].forEach((value, i) =>
      expect(scored[i]).toBeCloseTo(value, 15),
    );
  });

  it('returns null for a flat window, which has no pulse to score', () => {
    expect(zScoreWindow(new Array<number>(256).fill(-0.62))).toBeNull();
  });

  it('builds the SQI-Net input [2, 256]: primary (−R) then secondary (−G), each z-scored, as float32', () => {
    const primary = Array.from(
      { length: 256 },
      (_, k) => -0.6 - 0.004 * Math.sin((2 * Math.PI * 1.2 * k) / 64),
    );
    const secondary = Array.from(
      { length: 256 },
      (_, k) => -0.11 - 0.001 * Math.sin((2 * Math.PI * 1.2 * k) / 64 + 0.3),
    );
    const input = sqiModelInput(primary, secondary)!;
    expect(input).toBeInstanceOf(Float32Array);
    expect(input).toHaveLength(512);
    expect(Array.from(input.subarray(0, 256))).toEqual(Array.from(Float32Array.from(zScoreWindow(primary)!)));
    expect(Array.from(input.subarray(256))).toEqual(Array.from(Float32Array.from(zScoreWindow(secondary)!)));
  });

  it('gives no SQI input when either channel is flat', () => {
    const pulse = Array.from({ length: 256 }, (_, k) => Math.sin(k / 9));
    expect(sqiModelInput(pulse, new Array<number>(256).fill(-0.1))).toBeNull();
    expect(sqiModelInput(new Array<number>(256).fill(-1), pulse)).toBeNull();
  });

  it('rejects windows that are not 256 samples long', () => {
    const pulse = Array.from({ length: 255 }, (_, k) => Math.sin(k / 9));
    expect(() => sqiModelInput(pulse, pulse)).toThrow(RangeError);
  });
});
