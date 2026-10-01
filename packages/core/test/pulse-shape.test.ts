import { butterBandpass, DSP_CONFIG, ensembleBeat, filterZeroPhase, savgolFilter } from '../src';

const { beatSamples, leadFraction, minNormalBeats, minFps } = DSP_CONFIG.dsp14;
const RATE_HZ = DSP_CONFIG.dsp2.shapeRateHz;

// Asymmetric systolic wave (rise σ 40 ms, fall σ 90 ms) plus a dicrotic wave 300 ms after the peak: a
// steeper upstroke than downstroke, as in real finger PPG. Onsets sit 80 ms before each peak.
function syntheticPpg(
  peaksS: number[],
  seconds: number,
  dicroticRatio = 0.3,
  dicroticSigmaS = 0.06,
): number[] {
  return Array.from({ length: Math.round(seconds * RATE_HZ) }, (_, k) => {
    const tS = k / RATE_HZ;
    return peaksS.reduce((sum, peakS) => {
      const dt = tS - peakS;
      const systolic = Math.exp(-0.5 * (dt / (dt < 0 ? 0.04 : 0.09)) ** 2);
      return sum + systolic + dicroticRatio * Math.exp(-0.5 * ((dt - 0.3) / dicroticSigmaS) ** 2);
    }, 0);
  });
}

function regularPeaks(count: number, rrS: number): number[] {
  return Array.from({ length: count }, (_, i) => 1 + i * rrS);
}

const onsetsOf = (peaksS: number[]) => peaksS.map((peakS) => (peakS - 0.08) * RATE_HZ);
const allNormal = (count: number) => new Array<boolean>(count).fill(true);

function morphologyBand(wave: number[]): Float64Array {
  const { morphologyOrder, morphologyBandHz } = DSP_CONFIG.dsp6;
  return filterZeroPhase(
    butterBandpass(morphologyOrder, morphologyBandHz[0]!, morphologyBandHz[1]!, RATE_HZ),
    wave,
  );
}

// One beat cut and resampled exactly as the definition says: start a lead fraction of the period before
// the onset, 256 samples across one period, linear interpolation, then min–max normalization.
function referenceBeat(signal: ArrayLike<number>, onset: number, nextOnset: number): number[] {
  const period = nextOnset - onset;
  const raw = Array.from({ length: beatSamples }, (_, k) => {
    const x = onset + (k / beatSamples - leadFraction) * period;
    const j = Math.floor(x);
    return signal[j]! + (signal[j + 1]! - signal[j]!) * (x - j);
  });
  const low = Math.min(...raw);
  const high = Math.max(...raw);
  return raw.map((value) => (value - low) / (high - low));
}

describe('DSP-14 Savitzky–Golay (window 9, order 3, scipy mode "interp")', () => {
  it('uses the closed-form interior coefficients for smoothing and the second derivative', () => {
    const impulse = new Array<number>(41).fill(0);
    impulse[20] = 1;
    // Convolution with an impulse returns the coefficients, reversed (they are symmetric).
    const smooth = [-21, 14, 39, 54, 59, 54, 39, 14, -21].map((c) => c / 231);
    const second = [28, 7, -8, -17, -20, -17, -8, 7, 28].map((c) => c / 462);
    const smoothed = savgolFilter(impulse, 0);
    const curvature = savgolFilter(impulse, 2);
    smooth.forEach((c, i) => expect(smoothed[16 + i]).toBeCloseTo(c, 14));
    second.forEach((c, i) => expect(curvature[16 + i]).toBeCloseTo(c, 14));
  });

  it('reproduces a cubic and its second derivative exactly, edges included (polynomial fit at the ends)', () => {
    const cubic = (x: number) => 0.5 - 0.02 * x + 0.003 * x * x - 0.0001 * x ** 3;
    const values = Array.from({ length: 30 }, (_, x) => cubic(x));
    const smoothed = savgolFilter(values, 0);
    const curvature = savgolFilter(values, 2);
    values.forEach((value, x) => {
      expect(smoothed[x]).toBeCloseTo(value, 12);
      expect(curvature[x]).toBeCloseTo(0.006 - 0.0006 * x, 12);
    });
  });
});

describe('DSP-14 ensemble beat', () => {
  const peaks = regularPeaks(30, 0.83);
  const wave = syntheticPpg(peaks, 27);
  const onsets = onsetsOf(peaks);

  it('averages normalized, onset-aligned beats into one 256-sample period', () => {
    const shape = ensembleBeat(wave, onsets, allNormal(30), 60)!;
    // Beats 0–28 have a next onset; all 29 are usable.
    expect(shape.beatsUsed).toBe(29);
    expect(shape.beat).toHaveLength(beatSamples);
    const sums = new Array<number>(beatSamples).fill(0);
    for (let i = 0; i < 29; i++)
      referenceBeat(wave, onsets[i]!, onsets[i + 1]!).forEach((v, k) => (sums[k]! += v));
    sums.forEach((sum, k) => expect(shape.beat[k]).toBeCloseTo(sum / 29, 14));
  });

  it('is unchanged by a gain and an offset on the signal (per-beat min–max normalization)', () => {
    const reference = ensembleBeat(wave, onsets, allNormal(30), 60)!;
    const shifted = ensembleBeat(
      wave.map((value) => 0.7 + 1.3 * value),
      onsets,
      allNormal(30),
      60,
    )!;
    reference.beat.forEach((value, k) => expect(shifted.beat[k]).toBeCloseTo(value, 12));
  });

  it('uses a beat only when it and the next beat are normal', () => {
    const normal = allNormal(30);
    normal[10] = false; // removes beat 9 (its end) and beat 10
    const shape = ensembleBeat(wave, onsets, normal, 60)!;
    expect(shape.beatsUsed).toBe(27);
  });

  it('needs at least 20 usable normal beats', () => {
    const peaks21 = regularPeaks(21, 0.83);
    const wave21 = syntheticPpg(peaks21, 20);
    expect(ensembleBeat(wave21, onsetsOf(peaks21), allNormal(21), 60)!.beatsUsed).toBe(minNormalBeats);
    const peaks20 = regularPeaks(20, 0.83);
    expect(ensembleBeat(syntheticPpg(peaks20, 20), onsetsOf(peaks20), allNormal(20), 60)).toBeNull();
  });

  it('requires a configured capture rate of at least 60 fps (not a measured rate)', () => {
    expect(ensembleBeat(wave, onsets, allNormal(30), 60)).not.toBeNull();
    expect(ensembleBeat(wave, onsets, allNormal(30), 30)).toBeNull();
    expect(ensembleBeat(wave, onsets, allNormal(30), minFps - 1)).toBeNull();
  });

  it('drops a beat longer than 1.5 × the median period (a missed onset)', () => {
    // Removing onset 15 merges beats 14 and 15 into one double-length "beat" flagged normal.
    const missed = onsets.filter((_, i) => i !== 15);
    expect(ensembleBeat(wave, missed, allNormal(29), 60)!.beatsUsed).toBe(27);
    expect(DSP_CONFIG.dsp14.maxPeriodRatio).toBe(1.5);
  });

  it('averages two alternating beat shapes to their midpoint (hand-computed answer)', () => {
    // Beats of exactly 256 samples whose windows start on whole samples (onset = start + 25.6), so no
    // interpolation is involved: rising ramps k/255 and falling ramps 1 − k/255 alternate, already 0..1.
    // Ten of each average to 0.5 at every sample.
    const blocks = Array.from({ length: 21 }, (_, beat) =>
      Array.from({ length: 256 }, (_, k) => (beat % 2 === 0 ? k / 255 : 1 - k / 255)),
    );
    const signal = blocks.flat();
    const alignedOnsets = Array.from({ length: 21 }, (_, beat) => beat * 256 + 25.6);
    const shape = ensembleBeat(signal, alignedOnsets, allNormal(21), 60)!;
    expect(shape.beatsUsed).toBe(20);
    shape.beat.forEach((value) => expect(value).toBeCloseTo(0.5, 12));
  });

  it('skips beats whose window would run off the signal', () => {
    // The first onset sits 0.05 s in: its window would start before sample 0.
    const early = [0.13, ...peaks.slice(1)];
    const shape = ensembleBeat(syntheticPpg(early, 27), onsetsOf(early), allNormal(30), 60)!;
    expect(shape.beatsUsed).toBe(28);
  });

  it('rejects onsets and flags of different lengths', () => {
    expect(() => ensembleBeat(wave, onsets, allNormal(29), 60)).toThrow(RangeError);
  });
});

describe('DSP-14 a–e waves on the second derivative', () => {
  const lastIndex = Math.floor((leadFraction + DSP_CONFIG.dsp14.systoleFraction) * beatSamples + 0.5) - 1;
  const labels = (count: number, rrS: number, dicroticRatio = 0.3, dicroticSigmaS = 0.06) => {
    const peaks = regularPeaks(count, rrS);
    const wave = syntheticPpg(peaks, count * rrS + 2, dicroticRatio, dicroticSigmaS);
    return ensembleBeat(morphologyBand(wave), onsetsOf(peaks), allNormal(count), 60)!;
  };

  // Exact indices, the same as ml/lumen_dsp/tests/test_dsp_shape.py on the same synthetic signals.
  it.each([
    [72, 30, 0.83, [24, 49, 104, 144, 177]],
    [55, 25, 1.1, [25, 43, 85, 115, 140]],
    [100, 40, 0.6, [24, 58, 135, 189, null]],
  ])('labels a–e at %i bpm', (_bpm, count, rrS, expected) => {
    const { a, b, c, d, e } = labels(count as number, rrS as number).waves;
    expect([a, b, c, d, e]).toEqual(expected);
  });

  it('keeps a < b < c < d < e inside systole, with a before the systolic peak and extrema of the right kind', () => {
    const shape = labels(30, 0.83);
    const { a, b, c, d, e } = shape.waves;
    expect(a! < b! && b! < c! && c! < d! && d! < e!).toBe(true);
    expect(e!).toBeLessThanOrEqual(lastIndex);
    let systolicPeak = 0;
    for (let k = 0; k <= lastIndex; k++)
      if (shape.smoothed[k]! > shape.smoothed[systolicPeak]!) systolicPeak = k;
    expect(a!).toBeLessThan(systolicPeak);
    const d2 = shape.secondDerivative;
    for (const index of [a!, c!, e!])
      expect(d2[index]).toBeGreaterThanOrEqual(Math.max(d2[index - 1]!, d2[index + 1]!));
    for (const index of [b!, d!])
      expect(d2[index]).toBeLessThanOrEqual(Math.min(d2[index - 1]!, d2[index + 1]!));
  });

  it('takes b as the first minimum after a even when d is deeper', () => {
    // A sharp dicrotic wave (0.8, σ 30 ms) makes d the deepest point; the lowest-point rule would put b there.
    const shape = labels(30, 0.83, 0.8, 0.03);
    const { a, b, c, d, e } = shape.waves;
    expect(shape.secondDerivative[d!]!).toBeLessThan(shape.secondDerivative[b!]!);
    expect([a, b, c, d, e]).toEqual([24, 49, 120, 143, 165]);
  });
});
