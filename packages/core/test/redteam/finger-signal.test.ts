import {
  buildTimebase,
  dcLevel,
  DSP_CONFIG,
  fingerSignals,
  resampleCubic,
  sqiModelInput,
  zScoreWindow,
} from '../../src';
import { captureAt, jitteredOffsets, regularOffsets } from '../synthetic';
import { flatRed, outcomeOf, sinePulse } from './attacks';

const { modelRateHz } = DSP_CONFIG.dsp2;
const WINDOW_SAMPLES = DSP_CONFIG.dsp3.modelWindowS * modelRateHz;

// Every 256-sample SQI window of the first DSP-2 segment of a capture, step 64 (1 s).
function sqiWindows(offsetsS: number[], channels: Parameters<typeof captureAt>[1]): Float64Array[] {
  const { samples, stats } = captureAt(offsetsS, channels);
  const timebase = buildTimebase(samples, stats);
  const [segment] = resampleCubic(timebase.tS, fingerSignals(timebase).primary, modelRateHz);
  const windows: Float64Array[] = [];
  for (let start = 0; start + WINDOW_SAMPLES <= segment!.values.length; start += modelRateHz)
    windows.push(segment!.values.subarray(start, start + WINDOW_SAMPLES));
  return windows;
}

const sineWindow = () =>
  Array.from({ length: WINDOW_SAMPLES }, (_, k) => Math.sin((2 * Math.PI * 1.2 * k) / 64));

describe('red team: DSP-3 finger signals', () => {
  it('maps red clipped at 1.0 to exactly −1.0 and keeps green as the secondary', () => {
    const { samples, stats } = captureAt(regularOffsets(30, 1), flatRed(1.0));
    const signals = fingerSignals(buildTimebase(samples, stats));
    expect(new Set(signals.primary)).toEqual(new Set([-1]));
    expect(new Set(signals.secondary)).toEqual(new Set([-0.1]));
  });
});

describe('red team: DSP-3 z-scored model input', () => {
  it('scores an exposure step (0.60 → 0.65 halfway) to mean 0 and population SD 1', () => {
    const scored = zScoreWindow(Array.from({ length: WINDOW_SAMPLES }, (_, k) => (k < 128 ? -0.6 : -0.65)))!;
    expect(scored.reduce((total, value) => total + value, 0) / WINDOW_SAMPLES).toBeCloseTo(0, 12);
    expect(Math.sqrt(scored.reduce((total, value) => total + value * value, 0) / WINDOW_SAMPLES)).toBeCloseTo(
      1,
      12,
    );
    for (const value of scored) expect(Math.abs(value)).toBeCloseTo(1, 12);
  });

  it('gives a cold-hand pulse (amplitude 1e-6 on a 0.6 level) the same z-scores as a strong one', () => {
    const weak = zScoreWindow(sineWindow().map((value) => -0.6 - 1e-6 * value))!;
    const strong = zScoreWindow(sineWindow().map((value) => -0.6 - 0.01 * value))!;
    weak.forEach((value, k) => expect(value).toBeCloseTo(strong[k]!, 6));
  });

  it.each([0, 255, 257])('refuses an SQI window of %i samples', (length) => {
    expect(() => sqiModelInput(new Float64Array(length))).toThrow(RangeError);
  });

  // DEFECT: a NaN or Infinity sample makes every z-score NaN, and sqiModelInput hands that window to
  // SQI-Net. ADR 0023 lets only a real −R window reach the model; a bad one must be refused (null or
  // RangeError), as the flat window is.
  it.each([
    ['a NaN sample', NaN],
    ['an Infinity sample', Infinity],
    ['a −Infinity sample', -Infinity],
  ])('never returns a non-finite z-scored window for %s', (_label, badValue) => {
    const window = sineWindow();
    window[100] = badValue;
    expect(['null', 'RangeError']).toContain(outcomeOf(() => zScoreWindow(window)));
    expect(['null', 'RangeError']).toContain(outcomeOf(() => sqiModelInput(window)));
  });

  // DEFECT (ADR 0023: "A flat window never reaches the model"): a flat camera signal goes through DSP-1,
  // DSP-3 and DSP-2 and comes out of the spline with rounding noise (about 1e-16), so zScoreWindow does
  // not see a flat window and blows the rounding up to unit variance. In 168 flat captures (40 levels
  // 0.05–0.97 plus 0 and 1.0, 30/60 fps, with and without 2 ms jitter) 156 first windows were scored.
  // Python (scipy CubicSpline) keeps the constant exact and returns None for every one.
  it.each([
    ['red clipped at 1.0, jittered 30 fps', 1.0, jitteredOffsets(30, 10, 0.002)],
    ['red clipped at 1.0, jittered 60 fps', 1.0, jitteredOffsets(60, 10, 0.002)],
    ['red 0.6, regular 30 fps', 0.6, regularOffsets(30, 10)],
    ['red 0.6, regular 60 fps', 0.6, regularOffsets(60, 10)],
    ['red 0.123456789, jittered 30 fps', 0.123456789, jitteredOffsets(30, 10, 0.002)],
  ])('gives no SQI input for any window of a flat capture (%s)', (_label, level, offsetsS) => {
    const windows = sqiWindows(offsetsS, flatRed(level));
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.map((window) => sqiModelInput(window))).toEqual(windows.map(() => null));
  });

  it('still scores a real pulse after the same pipeline (the flat check must not reject signal)', () => {
    const windows = sqiWindows(jitteredOffsets(30, 10, 0.002), sinePulse(72));
    for (const window of windows) expect(sqiModelInput(window)).not.toBeNull();
  });
});

describe('red team: DSP-3 DC level', () => {
  it('returns a constant within 1e-12 of itself', () => {
    const level = dcLevel(new Float64Array(640).fill(0.6), modelRateHz);
    for (const value of level) expect(Math.abs(value - 0.6)).toBeLessThan(1e-12);
  });

  it('follows an exposure step 0.60 → 0.70: within 1% of each level 3 s from the step', () => {
    const stepped = Float64Array.from({ length: 20 * modelRateHz }, (_, k) => (k < 640 ? 0.6 : 0.7));
    const level = dcLevel(stepped, modelRateHz);
    expect(Math.abs(level[640 - 3 * modelRateHz]! - 0.6)).toBeLessThan(0.006);
    expect(Math.abs(level[640 + 3 * modelRateHz]! - 0.7)).toBeLessThan(0.007);
  });

  it('keeps at most 6% of a 36 bpm (0.6 Hz) pulse in the DC (ADR 0018)', () => {
    const pulse = Float64Array.from(
      { length: 60 * modelRateHz },
      (_, k) => 0.6 + 0.006 * Math.sin((2 * Math.PI * 0.6 * k) / modelRateHz),
    );
    const middle = dcLevel(pulse, modelRateHz).subarray(20 * modelRateHz, 40 * modelRateHz);
    const keptAmplitude = (Math.max(...middle) - Math.min(...middle)) / 2;
    expect(keptAmplitude / 0.006).toBeLessThanOrEqual(0.06);
  });

  it.each([
    ['9 samples (scipy padlen 9 needs more)', 9, modelRateHz],
    ['0 samples', 0, modelRateHz],
    ['a NaN rate', 640, NaN],
    ['a 0.6 Hz rate (0.3 Hz cutoff at Nyquist)', 640, 0.6],
  ])('throws RangeError for %s', (_label, length, rateHz) => {
    expect(() => dcLevel(new Float64Array(length).fill(0.6), rateHz)).toThrow(RangeError);
  });
});
