import { buildTimebase, DSP_CONFIG, resampleCubic, type ResampledSegment } from '../src';
import { captureAt, jitteredOffsets, regularOffsets } from './synthetic';

const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
const PULSE_HZ = 1.2; // 72 bpm
const OMEGA = 2 * Math.PI * PULSE_HZ;

function timebaseOf(offsetsS: number[], signal: (tS: number) => number) {
  const { samples, stats } = captureAt(offsetsS, (tS) => ({ r: signal(tS), g: 0.1, b: 0.05 }));
  return buildTimebase(samples, stats);
}

function maxError(
  segment: ResampledSegment,
  rateHz: number,
  truth: (tS: number) => number,
  fromS: number,
  toS: number,
) {
  let worst = 0;
  segment.values.forEach((value, k) => {
    const tS = (segment.firstIndex + k) / rateHz;
    if (tS >= fromS && tS <= toS) worst = Math.max(worst, Math.abs(value - truth(tS)));
  });
  return worst;
}

// Interior error bound of a cubic spline: (5/384)·h⁴·max|f''''| (de Boor, A Practical Guide to Splines,
// ch. IV). For a unit sine at 1.2 Hz, max|f''''| = ω⁴ ≈ 3.2e3; at 60 fps (h = 16.7 ms) the bound is
// 3.2e-6, and with ±2 ms jitter (h ≤ 20.7 ms) it is 7.6e-6. The natural end condition (f'' = 0) adds an
// O(h²) error at the ends that decays by about 0.27 per knot, so the first and last 0.5 s are excluded.
const sine = (tS: number) => Math.sin(OMEGA * tS);

describe('DSP-2 cubic-spline resampling', () => {
  it('reproduces a 1.2 Hz sine from 60 fps within the spline error bound', () => {
    const timebase = timebaseOf(regularOffsets(60, 10), sine);
    for (const rateHz of [modelRateHz, shapeRateHz]) {
      const [segment, ...rest] = resampleCubic(timebase.tS, timebase.r, rateHz);
      expect(rest).toHaveLength(0);
      expect(maxError(segment!, rateHz, sine, 0.5, 9.4)).toBeLessThan(1e-5);
    }
  });

  it('reproduces a sine from jittered timestamps within the bound for the largest interval', () => {
    const timebase = timebaseOf(jitteredOffsets(60, 10, 0.002), sine);
    const [segment] = resampleCubic(timebase.tS, timebase.r, shapeRateHz);
    expect(maxError(segment!, shapeRateHz, sine, 0.5, 9.4)).toBeLessThan(2e-5);
  });

  it('reproduces a straight line exactly, ends included (natural spline is exact for lines)', () => {
    const ramp = (tS: number) => 0.4 + 0.03 * tS;
    const timebase = timebaseOf(jitteredOffsets(30, 4, 0.005), ramp);
    const [segment] = resampleCubic(timebase.tS, timebase.r, modelRateHz);
    expect(maxError(segment!, modelRateHz, ramp, 0, 4)).toBeLessThan(1e-12);
  });

  it('puts grid points at k / rate seconds from capture start, inside the sampled span only', () => {
    const timebase = timebaseOf(regularOffsets(60, 10), sine);
    const [segment] = resampleCubic(timebase.tS, timebase.r, modelRateHz);
    // Last frame at 599/60 s; floor(599/60 · 64) = 638, so grid indices 0..638.
    expect(segment!.firstIndex).toBe(0);
    expect(segment!.values).toHaveLength(639);
  });

  it('splits at a 200 ms gap and never interpolates inside it', () => {
    const before = regularOffsets(60, 2);
    const after = regularOffsets(60, 2).map((offsetS) => before.at(-1)! + 0.2 + offsetS);
    const timebase = timebaseOf([...before, ...after], sine);
    const segments = resampleCubic(timebase.tS, timebase.r, modelRateHz);
    expect(segments).toHaveLength(2);
    const [first, second] = segments;
    const firstEndS = (first!.firstIndex + first!.values.length - 1) / modelRateHz;
    const secondStartS = second!.firstIndex / modelRateHz;
    expect(firstEndS).toBeLessThanOrEqual(before.at(-1)!);
    expect(secondStartS).toBeGreaterThanOrEqual(after[0]!);
  });

  it('bridges a 140 ms gap (dropped frames within the 150 ms limit)', () => {
    const before = regularOffsets(60, 2);
    const after = regularOffsets(60, 2).map((offsetS) => before.at(-1)! + 0.14 + offsetS);
    const timebase = timebaseOf([...before, ...after], sine);
    expect(resampleCubic(timebase.tS, timebase.r, modelRateHz)).toHaveLength(1);
  });

  it('bridges a gap of exactly 150 ms (only longer gaps split)', () => {
    // Frames at whole ns; 0.18 s then 0.33 s is a case where (t2 − t1) in seconds rounds to just over
    // 0.15, so this fails if the comparison ignores the 1 ns timestamp resolution.
    const before = Array.from({ length: 10 }, (_, k) => k * 0.02);
    const after = Array.from({ length: 10 }, (_, k) => 0.33 + k * 0.02);
    const timebase = timebaseOf([...before, ...after], sine);
    expect(resampleCubic(timebase.tS, timebase.r, modelRateHz)).toHaveLength(1);
  });

  it('interpolates a two-frame segment as a straight line (natural spline through two points)', () => {
    const before = regularOffsets(60, 1);
    const pair = [before.at(-1)! + 0.3, before.at(-1)! + 0.35];
    const after = regularOffsets(60, 1).map((offsetS) => pair[1]! + 0.3 + offsetS);
    const timebase = timebaseOf([...before, ...pair, ...after], sine);
    const segments = resampleCubic(timebase.tS, timebase.r, modelRateHz);
    expect(segments).toHaveLength(3);
    const middle = segments[1]!;
    const [t1, t2] = [timebase.tS[60]!, timebase.tS[61]!];
    const [y1, y2] = [timebase.r[60]!, timebase.r[61]!];
    expect(middle.values.length).toBeGreaterThanOrEqual(3);
    middle.values.forEach((value, k) => {
      const tS = (middle.firstIndex + k) / modelRateHz;
      expect(Math.abs(value - (y1 + ((y2 - y1) * (tS - t1)) / (t2 - t1)))).toBeLessThan(1e-15);
    });
  });

  it('drops a lone frame between two long gaps (a spline needs two points)', () => {
    const before = regularOffsets(60, 1);
    const lone = before.at(-1)! + 0.3;
    const after = regularOffsets(60, 1).map((offsetS) => lone + 0.3 + offsetS);
    const timebase = timebaseOf([...before, lone, ...after], sine);
    expect(resampleCubic(timebase.tS, timebase.r, modelRateHz)).toHaveLength(2);
  });
});
