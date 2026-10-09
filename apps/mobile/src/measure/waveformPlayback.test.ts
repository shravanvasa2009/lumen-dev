import {
  advancePlayhead,
  mergeSeries,
  playheadTargetS,
  PLAYBACK_DELAY_S,
  smoothClockOffset,
  tracePath,
  type TraceGeometry,
} from './waveformPlayback';

const geometry: TraceGeometry = { width: 308, height: 100, dotX: 300, padding: 8, windowS: 6, upIsHigh: false };
const range = { low: 0, high: 1 };
const series = (from: number, to: number, stepS = 0.04) => {
  const t: number[] = [];
  for (let time = from; time <= to + 1e-9; time += stepS) t.push(Number(time.toFixed(3)));
  return { t, v: t.map((time) => Math.sin(time * 6)) };
};
const xs = (d: string) => [...d.matchAll(/(-?\d+\.\d),-?\d+\.\d/g)].map((match) => Number(match[1]));

describe('mergeSeries', () => {
  it('replaces the stored samples a newer window covers and trims to the keep span', () => {
    const merged = mergeSeries(
      { t: [0, 1, 2, 3], v: [0, 1, 2, 3] },
      { t: [2.5, 3.5, 4.5], v: [9, 9, 9] },
      3,
    );
    expect(merged.t).toEqual([2, 2.5, 3.5, 4.5]);
    expect(merged.v).toEqual([2, 9, 9, 9]);
  });

  it('starts over when the incoming window is empty', () => {
    expect(mergeSeries({ t: [1], v: [1] }, { t: [], v: [] }, 5)).toEqual({ t: [], v: [] });
  });
});

describe('smoothClockOffset', () => {
  it('takes the first offset and follows an earlier arrival at once', () => {
    expect(smoothClockOffset(null, 500)).toBe(500);
    expect(smoothClockOffset(500, 470)).toBe(470);
  });

  it('barely moves for a late batch, so jitter does not show', () => {
    const moved = smoothClockOffset(500, 600);
    expect(moved).toBeGreaterThan(500);
    expect(moved).toBeLessThan(505);
  });
});

describe('advancePlayhead', () => {
  it('moves by the elapsed time at constant speed when the clock agrees', () => {
    let playhead = advancePlayhead(null, 16, 10, 20);
    for (let frame = 0; frame < 60; frame += 1) {
      playhead = advancePlayhead(playhead, 16, 10 + (16 * (frame + 1)) / 1000, 20);
    }
    expect(playhead).toBeCloseTo(10 + 0.96, 3);
  });

  it('never goes backward, never passes the newest sample, and resets after a long stall', () => {
    expect(advancePlayhead(10, 16, 9.9, 20)).toBeGreaterThanOrEqual(10);
    expect(advancePlayhead(10, 16, 10.01, 10.005)).toBe(10.005);
    expect(advancePlayhead(10, 16, 30, 40)).toBe(30);
  });

  it('keeps the speed within a few percent when the clock offset is corrected', () => {
    const before = 10;
    const after = advancePlayhead(before, 16, before + 0.016 + 0.05, 20);
    const speed = (after - before) / 0.016;
    expect(speed).toBeGreaterThan(1);
    expect(speed).toBeLessThan(1.06);
  });

  it('catches up after a short stall at no more than 1.25 times real time', () => {
    const after = advancePlayhead(10, 16, 10.8, 20);
    expect((after - 10) / 0.016).toBeLessThanOrEqual(1.25 + 1e-9);
  });

  it('targets the newest-sample time minus the playback delay', () => {
    expect(playheadTargetS(5000, 2000)).toBeCloseTo(3 - PLAYBACK_DELAY_S);
  });
});

describe('tracePath', () => {
  it('is empty before the playhead reaches the first sample', () => {
    expect(tracePath(series(5, 8), 4, range, geometry)).toBeNull();
  });

  it('grows from the right edge while the window fills', () => {
    const early = tracePath(series(0, 3), 1, range, geometry)!;
    const startX = xs(early.d)[0]!;
    expect(startX).toBeGreaterThan(200);
    expect(Math.max(...xs(early.d))).toBeCloseTo(300, 0);
  });

  it('shows exactly the 6 s ending at the playhead once full', () => {
    const full = tracePath(series(0, 10), 8, range, geometry)!;
    expect(xs(full.d)[0]!).toBeLessThanOrEqual(0.5);
    expect(xs(full.d)[0]!).toBeGreaterThan(-6);
  });

  it('moves every point by exactly the elapsed time times the speed', () => {
    const samples = series(0, 10, 0.1);
    const before = tracePath(samples, 8, range, geometry)!.d;
    const after = tracePath(samples, 8.1, range, geometry)!.d;
    expect(before).toContain('250.0,');
    expect(after).toContain('245.0,');
  });

  it('draws one point per few pixels at most, whatever the frame rate', () => {
    const dense = series(0, 10, 0.004);
    const segments = tracePath(dense, 8, range, geometry)!.d.match(/C/g)!;
    expect(segments.length).toBeLessThanOrEqual(300 / 2 + 2);
  });

  it('reuses nearly all drawn samples from frame to frame across batches in steady state', () => {
    const wide = { ...geometry, width: 1008, dotX: 1000 };
    const dense = series(0, 30, 0.008);
    let stored: { t: number[]; v: number[] } = { t: [], v: [] };
    let previous: Set<string> | null = null;
    for (let newest = 8; newest <= 12; newest += 0.1) {
      const from = dense.t.findIndex((time) => time >= newest - 6);
      const to = dense.t.findIndex((time) => time > newest);
      stored = mergeSeries(stored, { t: dense.t.slice(from, to), v: dense.v.slice(from, to) }, 6.8);
      const edge = newest - 0.3;
      const { d } = tracePath(stored, edge, range, wide)!;
      const drawn = new Set(
        [...d.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)].map(
          (match) => ((Number(match[1]) / 1000) * 6 + edge - 6).toFixed(2) + ':' + match[2],
        ),
      );
      if (previous) {
        const kept = [...drawn].filter((key) => previous!.has(key)).length;
        expect(kept / drawn.size).toBeGreaterThan(0.9);
      }
      previous = drawn;
    }
  });

  it('puts the dot between samples at the playhead', () => {
    const samples = { t: [0, 0.1, 0.2], v: [0, 1, 0] };
    const mid = tracePath(samples, 0.15, range, geometry)!;
    expect(mid.dotY).toBeCloseTo(8 + 0.5 * 84, 1);
  });

  it('holds flat through a gap and steps when samples resumes', () => {
    const samples = { t: [0, 0.04, 0.08, 3, 3.04], v: [0.2, 0.2, 0.2, 0.9, 0.9] };
    const inside = tracePath(samples, 2, range, geometry)!;
    expect(inside.dotY).toBeCloseTo(8 + 0.2 * 84, 1);
    expect(inside.d).toContain('L300.0');
    const after = tracePath(samples, 3.04, range, geometry)!;
    expect(after.dotY).toBeCloseTo(8 + 0.9 * 84, 1);
  });

  it('flips the trace when raw red falls as a beat rises', () => {
    const samples = { t: [0, 1], v: [1, 1] };
    const high = tracePath(samples, 1, { low: 0, high: 1 }, { ...geometry, upIsHigh: true })!;
    expect(high.dotY).toBeCloseTo(8, 1);
  });
});
