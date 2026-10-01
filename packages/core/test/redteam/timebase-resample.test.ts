import { buildTimebase, DSP_CONFIG, resampleCubic, type FrameStat, type Sample } from '../../src';
import { captureAt, jitteredOffsets, regularOffsets } from '../synthetic';
import { flatRed, sinePulse } from './attacks';

const { modelRateHz } = DSP_CONFIG.dsp2;

// Frames at whole-ns times from an arbitrary device clock; exposure 8 ms.
function framesAtNs(timesNs: number[]): { samples: Sample[]; stats: FrameStat[] } {
  return {
    samples: timesNs.map((tNs) => ({ tNs, r: 0.6, g: 0.1, b: 0.05 })),
    stats: timesNs.map((tNs) => ({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 })),
  };
}

// 30 fps from startNs up to the gap at gapAtS seconds, a gap of gapNs, then 1 s more.
function gapTimesNs(startNs: number, gapAtS: number, gapNs: number): number[] {
  const frameNs = 33_333_333;
  const before = Array.from({ length: Math.round(gapAtS * 30) }, (_, k) => startNs + k * frameNs);
  const resumeNs = before[before.length - 1]! + gapNs;
  return [...before, ...Array.from({ length: 30 }, (_, k) => resumeNs + k * frameNs)];
}

const segmentsOf = (timesNs: number[]) => {
  const { samples, stats } = framesAtNs(timesNs);
  const timebase = buildTimebase(samples, stats);
  return resampleCubic(timebase.tS, timebase.r, modelRateHz);
};

describe('red team: DSP-1 timebase', () => {
  it.each([0, 1])('refuses %i frames (a timebase needs 2)', (count) => {
    const { samples, stats } = captureAt(regularOffsets(30, 1).slice(0, count), flatRed(0.6));
    expect(() => buildTimebase(samples, stats)).toThrow(RangeError);
  });

  it.each([
    ['the first two frames share a timestamp', (k: number) => (k === 1 ? 0 : k)],
    ['the last two frames share a timestamp', (k: number) => (k === 29 ? 28 : k)],
    ['the whole capture runs backwards', (k: number) => 29 - k],
  ])('throws RangeError when %s', (_label, frameIndex) => {
    const timesNs = Array.from({ length: 30 }, (_, k) => 1e12 + frameIndex(k) * 33_333_333);
    const { samples, stats } = framesAtNs(timesNs);
    expect(() => buildTimebase(samples, stats)).toThrow(RangeError);
  });

  // DSP-1 needs native ns timestamps; a non-finite one cannot be put on a time axis.
  it.each([
    ['NaN', 'a middle frame', NaN, 10],
    ['NaN', 'the last frame', NaN, 29],
    ['+Infinity', 'a middle frame', Infinity, 10],
    ['+Infinity', 'the last frame', Infinity, 29],
    ['-Infinity', 'the first frame', -Infinity, 0],
  ])('throws RangeError for a %s timestamp on %s', (_name, _where, badNs, index) => {
    const timesNs = Array.from({ length: 30 }, (_, k) => 1e12 + k * 33_333_333);
    timesNs[index] = badNs;
    const { samples, stats } = framesAtNs(timesNs);
    expect(() => buildTimebase(samples, stats)).toThrow(RangeError);
  });

  it('gives the same seconds on a device clock just below 2^53 ns (about 104 days of uptime)', () => {
    const offsetsNs = jitteredOffsets(60, 10, 0.002).map((offsetS) => Math.round(offsetS * 1e9));
    const early = framesAtNs(offsetsNs.map((offsetNs) => 1e9 + offsetNs));
    const late = framesAtNs(offsetsNs.map((offsetNs) => 2 ** 53 - 11e9 + offsetNs));
    expect(buildTimebase(late.samples, late.stats).tS).toEqual(buildTimebase(early.samples, early.stats).tS);
  });

  it('stays within 1 ns of the true offsets when the clock crosses 2^53 (doubles step by 2 ns there)', () => {
    const offsetsNs = jitteredOffsets(60, 10, 0.002).map((offsetS) => Math.round(offsetS * 1e9));
    const { samples, stats } = framesAtNs(offsetsNs.map((offsetNs) => 2 ** 53 - 5e9 + offsetNs));
    const { tS } = buildTimebase(samples, stats);
    // An odd ns halfway between two doubles rounds by exactly 1 ns; ns → s division adds about 1e-16 s.
    offsetsNs.forEach((offsetNs, k) =>
      expect(Math.abs(tS[k]! - offsetNs / 1e9)).toBeLessThanOrEqual(1e-9 + 1e-15),
    );
  });

  it.each([30, 60])('flags one missing frame at %i fps as a dropped-frame gap', (fps) => {
    const { samples, stats } = captureAt(
      regularOffsets(fps, 2).filter((_, k) => k !== 30),
      flatRed(0.6),
    );
    expect(buildTimebase(samples, stats).droppedGapStarts).toEqual([29]);
  });

  it('takes a 2-frame capture: its one interval is the median and nothing is dropped', () => {
    const { samples, stats } = framesAtNs([7e11, 7e11 + 33_333_333]);
    const timebase = buildTimebase(samples, stats);
    expect(timebase.medianFrameIntervalS).toBeCloseTo(0.033333333, 12);
    expect(timebase.droppedGapStarts).toEqual([]);
  });

  it('flags a 1-hour stall between two runs of frames without throwing', () => {
    const { samples, stats } = framesAtNs(gapTimesNs(1e12, 1, 3600e9));
    expect(buildTimebase(samples, stats).droppedGapStarts).toEqual([29]);
  });

  // KNOWN LIMITATION of the spec rule, not of the code: DSP-1 measures gaps against the median interval, so
  // a 60 fps camera that drops every third frame has a 33 ms median and no gap counts as dropped, though
  // a third of the frames are missing. CaptureStatus.droppedFrac (native, CAP-1) is the other guard.
  it('KNOWN LIMITATION: dropping every third frame at 60 fps (26 of 79 gaps are 33 ms) flags nothing', () => {
    const { samples, stats } = captureAt(
      regularOffsets(60, 2).filter((_, k) => k % 3 !== 1),
      flatRed(0.6),
    );
    const timebase = buildTimebase(samples, stats);
    expect(timebase.medianFrameIntervalS).toBeCloseTo(2 / 60, 6);
    expect(timebase.droppedGapStarts).toEqual([]);
  });
});

describe('red team: DSP-2 resampling', () => {
  it('returns no segments for empty input or a single frame', () => {
    expect(resampleCubic(new Float64Array(0), new Float64Array(0), modelRateHz)).toEqual([]);
    expect(resampleCubic(Float64Array.of(0.5), Float64Array.of(-0.6), modelRateHz)).toEqual([]);
  });

  // Gap = 150 ms − 1 ns, exactly 150 ms, 150 ms + 1 ns; 1 s into the capture, 10 minutes in, and on a
  // device clock just below 2^53 ns. Only a gap longer than 150 ms splits (DSP-2).
  it.each([
    [150e6 - 1, '1 s in', 1, 1e12, 1],
    [150e6, '1 s in', 1, 1e12, 1],
    [150e6 + 1, '1 s in', 2, 1e12, 1],
    [150e6 - 1, '10 minutes in', 1, 1e12, 600],
    [150e6, '10 minutes in', 1, 1e12, 600],
    [150e6 + 1, '10 minutes in', 2, 1e12, 600],
    [150e6, '1 s in on a clock near 2^53 ns', 1, 2 ** 53 - 20e9, 1],
    [150e6 + 1, '1 s in on a clock near 2^53 ns', 2, 2 ** 53 - 20e9, 1],
  ])('a gap of %i ns, %s, gives %i segment(s)', (gapNs, _where, segmentCount, startNs, gapAtS) => {
    expect(segmentsOf(gapTimesNs(startNs, gapAtS, gapNs))).toHaveLength(segmentCount);
  });

  it('bridges one missing frame at 30 fps (a 67 ms gap) and reproduces a line exactly across it', () => {
    const offsetsS = regularOffsets(30, 2).filter((_, k) => k !== 30);
    const tS = Float64Array.from(offsetsS);
    const segments = resampleCubic(
      tS,
      Float64Array.from(offsetsS, (offsetS) => 0.6 - 0.01 * offsetS),
      modelRateHz,
    );
    expect(segments).toHaveLength(1);
    segments[0]!.values.forEach((value, k) =>
      expect(value).toBeCloseTo(0.6 - (0.01 * (segments[0]!.firstIndex + k)) / modelRateHz, 12),
    );
  });

  // Frames 30 fps apart; the lone frame is 200 ms from the others, and the grid must stay inside the run.
  it.each([
    ['first', [0, 0.2, 0.2333, 0.2667, 0.3, 0.3333], 0.2, 0.3333],
    ['last', [0, 0.0333, 0.0667, 0.1, 0.1333, 0.3333], 0, 0.1333],
  ])('drops a lone frame that is %s in the capture', (_where, offsetsS, runStartS, runEndS) => {
    const segments = resampleCubic(
      Float64Array.from(offsetsS),
      Float64Array.from(offsetsS, () => -0.6),
      modelRateHz,
    );
    expect(segments).toHaveLength(1);
    const { firstIndex, values } = segments[0]!;
    expect(firstIndex / modelRateHz).toBeGreaterThanOrEqual(runStartS);
    expect((firstIndex + values.length - 1) / modelRateHz).toBeLessThanOrEqual(runEndS);
  });

  it('drops a 2-frame segment (0.110 → 0.115 s) that holds no 64 Hz grid point', () => {
    const tS = Float64Array.of(0.11, 0.115, 0.4, 0.43);
    const segments = resampleCubic(tS, Float64Array.of(1, 2, 3, 4), modelRateHz);
    expect(segments.map((segment) => segment.firstIndex)).toEqual([Math.ceil(0.4 * modelRateHz)]);
  });

  // DEFECT: the spline evaluation is not exact for a constant, so a flat camera signal (finger off, or red
  // clipped at 1.0) comes out with rounding noise. scipy's CubicSpline (the Python mirror) keeps it exact.
  it.each([
    ['clipped red, 1.0, jittered 30 fps', 1.0, jitteredOffsets(30, 10, 0.002)],
    ['clipped red, 1.0, jittered 60 fps', 1.0, jitteredOffsets(60, 10, 0.002)],
    ['red 0.0737, regular 30 fps', 0.0737, regularOffsets(30, 10)],
    ['red 0.6, regular 30 fps', 0.6, regularOffsets(30, 10)],
  ])('keeps a constant exactly constant (%s), as scipy CubicSpline does', (_label, level, offsetsS) => {
    const { samples, stats } = captureAt(offsetsS, flatRed(level));
    const timebase = buildTimebase(samples, stats);
    const [segment] = resampleCubic(timebase.tS, timebase.r, modelRateHz);
    expect(new Set(segment!.values)).toEqual(new Set([level]));
  });

  // DEFECT: §10.2 parity. scipy 1.17.1 CubicSpline raises ValueError for each of these ("`y` must contain
  // only finite values", "`x` must be strictly increasing sequence", length mismatch); the TypeScript
  // mirror returns NaN segments or silently drops the data.
  const tS = Float64Array.of(0, 0.03, 0.06, 0.09, 0.12);
  const values = Float64Array.of(-0.6, -0.61, -0.6, -0.59, -0.6);
  it.each([
    ['a NaN value', tS, Float64Array.of(-0.6, NaN, -0.6, -0.59, -0.6)],
    ['an Infinity value', tS, Float64Array.of(-0.6, -0.61, Infinity, -0.59, -0.6)],
    ['a NaN time', Float64Array.of(0, NaN, 0.06, 0.09, 0.12), values],
    ['a duplicated time', Float64Array.of(0, 0.03, 0.03, 0.09, 0.12), values],
    ['reversed times', Float64Array.of(0.12, 0.09, 0.06, 0.03, 0), values],
    ['fewer values than times', tS, values.subarray(0, 3)],
  ])('throws RangeError for %s, as scipy CubicSpline does', (_label, times, channel) => {
    expect(() => resampleCubic(times, channel, modelRateHz)).toThrow(RangeError);
  });

  it('keeps a pulse sampled across the 2^53 ns clock boundary within 1e-6 of the same pulse early on', () => {
    const offsetsS = jitteredOffsets(30, 10, 0.002);
    const early = captureAt(offsetsS, sinePulse(72));
    const late = {
      samples: early.samples.map((sample) => ({
        ...sample,
        tNs: sample.tNs - early.samples[0]!.tNs + 2 ** 53 - 5e9,
      })),
      stats: early.stats.map((stat) => ({ ...stat, tNs: stat.tNs - early.stats[0]!.tNs + 2 ** 53 - 5e9 })),
    };
    const resample = (capture: typeof early) => {
      const timebase = buildTimebase(capture.samples, capture.stats);
      return resampleCubic(timebase.tS, timebase.r, modelRateHz)[0]!.values;
    };
    const lateValues = resample(late);
    resample(early).forEach((value, k) => expect(Math.abs(lateValues[k]! - value)).toBeLessThan(1e-6));
  });
});
