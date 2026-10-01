import { DSP_CONFIG, hasEnoughUsableIntervals, rhythmFeatureVector, rhythmWindows } from '../../src';
import { outcomeOf } from './attacks';

const { windowIntervals, windowStep } = DSP_CONFIG.dsp15;

const clean = (count: number) => new Array<boolean>(count).fill(false);
const windowsOf = (intervalsS: number[], atypicalBeats = clean(intervalsS.length + 1)) =>
  rhythmWindows(intervalsS, clean(intervalsS.length), atypicalBeats);
const alternating = (first: number, second: number, count: number) =>
  Array.from({ length: count }, (_, k) => (k % 2 === 0 ? first : second));

// Park–Miller (16807, mod 2³¹ − 1) uniforms, exact in doubles.
function uniforms(count: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  });
}

// Usable runs of the given lengths, each followed by one interval that spans an artifact.
function runsWithArtifacts(runLengths: number[]): boolean[] {
  return runLengths.flatMap((length) => [...clean(length), true]);
}

describe('red team: DSP-15 never rejects for irregularity', () => {
  it('windows 200 AF-like intervals (uniform 0.3–2.0 s, seed 7) exactly like 200 regular ones', () => {
    const irregular = uniforms(200, 7).map((u) => 0.3 + 1.7 * u);
    const irregularStarts = windowsOf(irregular).map((window) => window.startInterval);
    expect(irregularStarts).toEqual(
      windowsOf(new Array<number>(200).fill(0.9)).map((window) => window.startInterval),
    );
    expect(irregularStarts).toHaveLength(Math.floor((200 - windowIntervals) / windowStep) + 1);
    for (const window of windowsOf(irregular))
      expect(rhythmFeatureVector(window).every(Number.isFinite)).toBe(true);
  });

  it('keeps every premature beat (0.5 s, then a 1.3 s pause, every 8th beat of 0.9 s) and counts it atypical', () => {
    const intervalsS = Array.from({ length: 96 }, (_, k) => (k % 8 === 6 ? 0.5 : k % 8 === 7 ? 1.3 : 0.9));
    // The premature beat ends the short interval: beat k + 1 for interval k.
    const atypical = Array.from({ length: 97 }, (_, beat) => beat % 8 === 7);
    const windows = windowsOf(intervalsS, atypical);
    expect(windows.map((window) => window.startInterval)).toEqual([0, 16, 32, 48, 64]);
    for (const window of windows) {
      const bounding = atypical.slice(window.startInterval, window.startInterval + windowIntervals + 1);
      expect(window.atypicalFraction).toBe(bounding.filter(Boolean).length / (windowIntervals + 1));
      expect(window.atypicalFraction).toBeGreaterThan(0);
    }
  });

  it('gives exact features for an alternating 0.6 / 1.0 s series (bigeminy-like)', () => {
    const [window] = windowsOf(alternating(0.6, 1.0, 32));
    expect(window!.normalizedRmssd).toBeCloseTo(0.4 / 0.8, 12);
    expect(window!.shannonEntropyBits).toBe(1);
    expect(window!.turningPointRatio).toBe(1);
    expect(window!.pnn50).toBe(1);
    // 31 differences, 16 of +0.4 and 15 of −0.4; every (RRn + RRn+1) is 1.6, so SD2 is 0.
    expect(window!.sd1S).toBeCloseTo((0.4 / Math.SQRT2) * Math.sqrt(1 - 1 / 31 ** 2), 12);
    expect(window!.sd2S).toBe(0);
    // Same-parity templates match and others are 0.4 apart (> r = 0.04): B = A = 2·C(15, 2).
    expect(window!.sampleEntropy).toBe(0);
  });
});

describe('red team: DSP-15 interval extremes (DSP-9 limits 0.25 s and 2.5 s)', () => {
  it.each([0.25, 2.5])('gives an all-zero feature vector for 32 intervals of exactly %s s', (intervalS) => {
    const [window] = windowsOf(new Array<number>(32).fill(intervalS));
    rhythmFeatureVector(window!).forEach((feature) => expect(feature).toBeCloseTo(0, 15));
  });

  it('gives exact features for intervals alternating 0.25 / 2.5 s', () => {
    const [window] = windowsOf(alternating(0.25, 2.5, 32));
    expect(window!.normalizedRmssd).toBeCloseTo(2.25 / 1.375, 12);
    expect(window!.shannonEntropyBits).toBe(1);
    expect(window!.turningPointRatio).toBe(1);
    expect(window!.pnn50).toBe(1);
    expect(window!.sd2S).toBe(0);
    expect(window!.sampleEntropy).toBe(0);
  });
});

describe('red team: DSP-15 usable-interval count and windows', () => {
  it.each([
    ['39 clean intervals', false, clean(39)],
    ['40 clean intervals', true, clean(40)],
    ['41 intervals, one spanning an artifact (40 usable)', true, [...clean(40), true]],
    ['40 intervals, one spanning an artifact (39 usable)', false, [...clean(39), true]],
    ['1000 intervals that all span an artifact', false, new Array<boolean>(1000).fill(true)],
    ['no intervals', false, []],
  ])('%s → enough: %s', (_label, enough, spansArtifact) => {
    expect(hasEnoughUsableIntervals(spansArtifact)).toBe(enough);
  });

  // ADR 0024: a reading can pass the 40-interval check and still have no window.
  it('passes the check with runs of 20 + 20 usable intervals yet yields no window', () => {
    const spansArtifact = runsWithArtifacts([20, 20]);
    expect(hasEnoughUsableIntervals(spansArtifact)).toBe(true);
    const count = spansArtifact.length;
    expect(rhythmWindows(new Array<number>(count).fill(0.9), spansArtifact, clean(count + 1))).toEqual([]);
  });

  it.each([
    [31, 0],
    [32, 1],
    [47, 1],
    [48, 2],
  ])('cuts a usable run of %i intervals into %i window(s)', (runLength, windowCount) => {
    const spansArtifact = [true, ...runsWithArtifacts([runLength])];
    const count = spansArtifact.length;
    const windows = rhythmWindows(new Array<number>(count).fill(0.9), spansArtifact, clean(count + 1));
    expect(windows).toHaveLength(windowCount);
    for (const window of windows) expect(window.startInterval).toBeGreaterThanOrEqual(1);
  });

  it('yields no window when every interval spans an artifact', () => {
    expect(
      rhythmWindows(new Array<number>(1000).fill(0.9), new Array<boolean>(1000).fill(true), clean(1001)),
    ).toEqual([]);
  });

  it('takes an empty reading (0 intervals, 1 beat) and refuses 0 beats', () => {
    expect(rhythmWindows([], [], [false])).toEqual([]);
    expect(() => rhythmWindows([], [], [])).toThrow(RangeError);
  });
});

describe('red team: DSP-15 feature vector stays finite (ADR 0024)', () => {
  // DEFECT: ADR 0024 says the Rhythm-Net vector is "always 8 finite numbers". An interval that is not
  // flagged as spanning an artifact but is NaN, Infinity, or 0 gives NaN features. A naive DSP-9 range
  // check (interval < 0.25 || interval > 2.5) is false for NaN, so it would not flag it either.
  it.each([
    ['one NaN interval among 0.8 s', Object.assign(new Array<number>(32).fill(0.8), { 5: NaN })],
    ['one Infinity interval among 0.8 s', Object.assign(new Array<number>(32).fill(0.8), { 5: Infinity })],
    ['32 intervals of 0 s', new Array<number>(32).fill(0)],
  ])('never yields a non-finite feature vector for %s', (_label, intervalsS) => {
    const outcome = outcomeOf(() => windowsOf(intervalsS).flatMap((window) => rhythmFeatureVector(window)));
    expect(['finite', 'RangeError']).toContain(outcome);
  });
});
