import {
  DSP_CONFIG,
  hasEnoughUsableIntervals,
  rhythmFeatureVector,
  rhythmWindows,
  type RhythmWindow,
} from '../src';

const { windowIntervals } = DSP_CONFIG.dsp15;

const clean = (count: number) => new Array<boolean>(count).fill(false);
const onlyWindow = (intervalsS: number[]): RhythmWindow => {
  const windows = rhythmWindows(intervalsS, clean(intervalsS.length), clean(intervalsS.length + 1));
  expect(windows).toHaveLength(1);
  return windows[0]!;
};

// Park–Miller (16807, mod 2³¹ − 1), exact in doubles.
function uniforms(count: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  });
}

describe('DSP-15 windows by beat count', () => {
  it('takes 32 intervals with a step of 16 and drops a trailing partial window', () => {
    const intervals = new Array<number>(80).fill(0.9);
    expect(rhythmWindows(intervals, clean(80), clean(81)).map((w) => w.startInterval)).toEqual([
      0, 16, 32, 48,
    ]);
    const shorter = intervals.slice(0, 79);
    expect(rhythmWindows(shorter, clean(79), clean(80)).map((w) => w.startInterval)).toEqual([0, 16, 32]);
  });

  it('never lets a window span an excluded interval: each run of usable intervals is windowed alone', () => {
    const spans = clean(100);
    spans[40] = true;
    const windows = rhythmWindows(new Array<number>(100).fill(0.9), spans, clean(101));
    // Run 0–39 (40 intervals): start 0 only. Run 41–99 (59 intervals): starts 41 and 57.
    expect(windows.map((w) => w.startInterval)).toEqual([0, 41, 57]);
    for (const window of windows) expect(window.intervalsS).toHaveLength(windowIntervals);
  });

  it('counts atypical beats among the 33 beats that bound a window', () => {
    const atypical = clean(33);
    atypical[5] = true;
    atypical[32] = true;
    const [window] = rhythmWindows(new Array<number>(32).fill(0.9), clean(32), atypical);
    expect(window!.atypicalFraction).toBeCloseTo(2 / 33, 15);
  });

  it('rejects inputs whose lengths do not line up (n intervals, n flags, n + 1 beats)', () => {
    expect(() => rhythmWindows([0.9, 0.9], clean(1), clean(3))).toThrow(RangeError);
    expect(() => rhythmWindows([0.9, 0.9], clean(2), clean(2))).toThrow(RangeError);
  });
});

describe('DSP-15 reading check', () => {
  it('needs at least 40 usable intervals', () => {
    const spans = clean(41);
    spans[3] = true;
    expect(hasEnoughUsableIntervals(spans)).toBe(true);
    spans[7] = true;
    expect(hasEnoughUsableIntervals(spans)).toBe(false);
  });
});

describe('DSP-15 features, known answers', () => {
  // 0.8, 1.0, 0.8, … : mean 0.9, every successive difference ±0.2.
  const alternating = Array.from({ length: 32 }, (_, k) => (k % 2 === 0 ? 0.8 : 1.0));

  it('alternating intervals: RMSSD/mean, entropy, turning points, pNN50', () => {
    const window = onlyWindow(alternating);
    expect(window.normalizedRmssd).toBeCloseTo(0.2 / 0.9, 12);
    // Two occupied bins (min goes to bin 0, max to the last bin), half each: 1 bit.
    expect(window.shannonEntropyBits).toBeCloseTo(1, 12);
    expect(window.turningPointRatio).toBe(1);
    expect(window.pnn50).toBe(1);
  });

  it('alternating intervals: Poincaré SD1 = SD of diff/√2, SD2 = 0', () => {
    const window = onlyWindow(alternating);
    // 31 differences: 16 of +0.2 and 15 of −0.2; population SD of d/√2.
    const scaled = Array.from({ length: 31 }, (_, k) => (k % 2 === 0 ? 0.2 : -0.2) / Math.SQRT2);
    const mean = scaled.reduce((sum, value) => sum + value, 0) / 31;
    const sd1 = Math.sqrt(scaled.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 31);
    expect(window.sd1S).toBeCloseTo(sd1, 12);
    expect(window.sd2S).toBeCloseTo(0, 12);
  });

  it('alternating intervals: sample entropy 0 (every 2-match extends to a 3-match)', () => {
    // r = 0.2 · 0.1 = 0.02. Templates of length 2 and 3 alternate between two shapes, 15 each among the
    // first N − m = 30 starts, so A = B = 2 · C(15, 2) = 210.
    expect(onlyWindow(alternating).sampleEntropy).toBeCloseTo(0, 15);
  });

  it('constant intervals: every spread feature is 0', () => {
    const window = onlyWindow(new Array<number>(32).fill(0.9));
    expect([
      window.normalizedRmssd,
      window.shannonEntropyBits,
      window.turningPointRatio,
      window.pnn50,
    ]).toEqual([0, 0, 0, 0]);
    expect([window.sd1S, window.sd2S]).toEqual([0, 0]);
  });

  it('ties are not turning points, and pNN50 counts only differences strictly over 50 ms', () => {
    // 0.80, 0.80, 0.85, 0.80, 0.85, …: differences 0, then ±0.05 exactly (as computed in doubles).
    const intervals = [0.8, ...Array.from({ length: 31 }, (_, k) => (k % 2 === 0 ? 0.8 : 0.85))];
    const window = onlyWindow(intervals);
    // Index 1 sits between a tie and a rise: not a turning point. Indices 2–30 alternate: 29 turning points.
    expect(window.turningPointRatio).toBeCloseTo(29 / 30, 15);
    const strictlyOver = intervals
      .slice(1)
      .filter((value, k) => Math.abs(value - intervals[k]!) > 0.05).length;
    expect(window.pnn50).toBeCloseTo(strictlyOver / 31, 15);
  });

  it('keeps the window’s intervals in order', () => {
    const intervals = Array.from({ length: 32 }, (_, k) => 0.7 + k / 100);
    expect(onlyWindow(intervals).intervalsS).toEqual(intervals);
  });
});

describe('DSP-15 features match direct transcriptions of their definitions', () => {
  // Seed 29 gives B = 12 and A = 3 template matches, so sample entropy is defined.
  const intervals = uniforms(32, 29).map((u) => 0.4 + 0.8 * u);
  const window = onlyWindow(intervals);
  const n = intervals.length;
  const mean = intervals.reduce((sum, value) => sum + value, 0) / n;
  const sd = Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n);

  it('Shannon entropy of a 16-bin histogram over [min, max], in bits', () => {
    const low = Math.min(...intervals);
    const high = Math.max(...intervals);
    const counts = new Array<number>(16).fill(0);
    for (const value of intervals) counts[Math.min(15, Math.floor(((value - low) / (high - low)) * 16))]!++;
    const entropy = -counts.filter((c) => c > 0).reduce((sum, c) => sum + (c / n) * Math.log2(c / n), 0);
    expect(window.shannonEntropyBits).toBeCloseTo(entropy, 12);
  });

  it('sample entropy, Richman–Moorman: r = 0.2 · population SD, Chebyshev ≤ r, N − m templates', () => {
    const r = 0.2 * sd;
    const matches = (length: number) => {
      let count = 0;
      for (let i = 0; i < n - 2; i++)
        for (let j = i + 1; j < n - 2; j++) {
          let distance = 0;
          for (let k = 0; k < length; k++)
            distance = Math.max(distance, Math.abs(intervals[i + k]! - intervals[j + k]!));
          if (distance <= r) count++;
        }
      return count;
    };
    expect(matches(3)).toBeGreaterThan(0);
    expect(window.sampleEntropy).toBeCloseTo(-Math.log(matches(3) / matches(2)), 12);
  });

  it('gives no sample entropy when no 3-long templates match (seed 1: B = 4, A = 0)', () => {
    const noTripleMatches = uniforms(32, 1).map((u) => 0.4 + 0.8 * u);
    expect(onlyWindow(noTripleMatches).sampleEntropy).toBeNull();
  });
});

describe('DSP-15 pNN50 counts differences strictly greater than 50 ms', () => {
  const alternating = (low: number, high: number) =>
    Array.from({ length: 32 }, (_, k) => (k % 2 === 0 ? low : high));

  it('counts 62.5 ms and skips 46.875 ms (both exact in binary)', () => {
    expect(onlyWindow(alternating(0.75, 0.8125)).pnn50).toBe(1);
    expect(onlyWindow(alternating(0.75, 0.796875)).pnn50).toBe(0);
  });

  it('skips a difference exactly equal to the 0.05 threshold', () => {
    // 0.1 − 0.05 is exactly the double 0.05 (0.1 = 2 × 0.05 in binary), so only > vs ≥ decides.
    expect(0.1 - 0.05).toBe(DSP_CONFIG.dsp15.pnnThresholdS);
    expect(onlyWindow(alternating(0.05, 0.1)).pnn50).toBe(0);
  });
});

describe('DSP-15 Rhythm-Net feature vector (§11.3)', () => {
  it('lists the 8 features in order: nRMSSD, ShEn, TPR, SD1, SD2, pNN50, SampEn, atypical fraction', () => {
    const intervals = uniforms(32, 29).map((u) => 0.4 + 0.8 * u);
    const atypical = clean(33);
    atypical[4] = true;
    const [window] = rhythmWindows(intervals, clean(32), atypical);
    expect(rhythmFeatureVector(window!)).toEqual([
      window!.normalizedRmssd,
      window!.shannonEntropyBits,
      window!.turningPointRatio,
      window!.sd1S,
      window!.sd2S,
      window!.pnn50,
      window!.sampleEntropy,
      window!.atypicalFraction,
    ]);
    expect(rhythmFeatureVector(window!)).toHaveLength(8);
  });

  it('passes an undefined sample entropy through as null until the fill rule is decided', () => {
    const window = onlyWindow(uniforms(32, 1).map((u) => 0.4 + 0.8 * u));
    expect(rhythmFeatureVector(window)[6]).toBeNull();
  });
});
