import { buildTimebase } from '../src';
import { captureAt, jitteredOffsets, regularOffsets } from './synthetic';

const flat = () => ({ r: 0.6, g: 0.1, b: 0.05 });

describe('DSP-1 timebase', () => {
  it('converts native ns to seconds from capture start', () => {
    const { samples, stats } = captureAt(regularOffsets(60, 1), flat);
    const timebase = buildTimebase(samples, stats);
    expect(timebase.tS[0]).toBe(0);
    expect(timebase.tS[59]).toBeCloseTo(59 / 60, 9);
    expect(timebase.medianFrameIntervalS).toBeCloseTo(1 / 60, 9);
    expect(timebase.droppedGapStarts).toEqual([]);
  });

  it('carries exposure and channel values through per frame', () => {
    const { samples, stats } = captureAt(
      regularOffsets(30, 1),
      (tS) => ({ r: tS, g: 0.2, b: 0.1 }),
      4_000_000,
    );
    const timebase = buildTimebase(samples, stats);
    expect(Array.from(timebase.exposureNs)).toEqual(new Array(30).fill(4_000_000));
    expect(timebase.r[15]).toBeCloseTo(0.5, 9);
    expect(timebase.g[15]).toBe(0.2);
  });

  it('does not report jitter well under 1.5x the median interval as dropped', () => {
    const { samples, stats } = captureAt(jitteredOffsets(60, 5, 0.002), flat);
    expect(buildTimebase(samples, stats).droppedGapStarts).toEqual([]);
  });

  it('reports a gap > 1.5x the median interval as dropped frames', () => {
    const offsets = regularOffsets(60, 2).filter((_, k) => k !== 30 && k !== 91 && k !== 92);
    const { samples, stats } = captureAt(offsets, flat);
    expect(buildTimebase(samples, stats).droppedGapStarts).toEqual([29, 89]);
  });

  it('rejects timestamps that do not strictly increase', () => {
    const { samples, stats } = captureAt([0, 1 / 60, 1 / 60, 3 / 60], flat);
    expect(() => buildTimebase(samples, stats)).toThrow(RangeError);
  });

  it('rejects frame stats that do not line up with samples', () => {
    const { samples, stats } = captureAt(regularOffsets(60, 1), flat);
    expect(() => buildTimebase(samples, stats.slice(1))).toThrow(RangeError);
  });
});
