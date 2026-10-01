import { DSP_CONFIG, estimateLiveHeartRate, resampleCubic, type Sample } from '../src';
import { captureAt, jitteredOffsets, regularOffsets } from './synthetic';

const SAMPLE_JITTER_S = 0.002;

// Red falls as blood volume rises, with a second harmonic for a PPG-like shape and a slow baseline drift.
function pulseRed(bpm: number) {
  const hz = bpm / 60;
  return (tS: number) => ({
    r:
      0.6 +
      0.02 * Math.sin(2 * Math.PI * 0.07 * tS) -
      0.006 * (Math.sin(2 * Math.PI * hz * tS) + 0.4 * Math.sin(4 * Math.PI * hz * tS + 0.5)),
    g: 0.1,
    b: 0.05,
  });
}

function sineRed(bpm: number) {
  return (tS: number) => ({ r: 0.6 - 0.006 * Math.sin((2 * Math.PI * bpm * tS) / 60), g: 0.1, b: 0.05 });
}

function samplesAt(offsetsS: number[], channels: (tS: number) => { r: number; g: number; b: number }) {
  return captureAt(offsetsS, channels).samples;
}

// Frames from 0 to `seconds`, minus those strictly inside (gapStartS, gapStartS + gapS).
function offsetsWithGap(fps: number, seconds: number, gapStartS: number, gapS: number): number[] {
  return regularOffsets(fps, seconds).filter((tS) => tS <= gapStartS || tS >= gapStartS + gapS);
}

// The proof's pulseSpectrum (scripts/proof/m0.mjs) transcribed loop for loop, at 64 Hz on the whole
// segment instead of the last 20 s at 30 Hz. Bins are 0.6 + j·0.01 Hz, j = 0..290, the 291 bins the
// proof's accumulating loop visits.
function referenceSpectrum(uniform: Float64Array, rateHz: number): { bpm: number; snrDb: number } {
  const win = Math.round(1.5 * rateHz);
  const detrended = Array.from(uniform, (value, i) => {
    const from = Math.max(0, i - win);
    const to = Math.min(uniform.length, i + win);
    let sum = 0;
    for (let k = from; k < to; k++) sum += uniform[k]!;
    return value - sum / (to - from);
  });
  const n = detrended.length;
  const powers: { f: number; p: number }[] = [];
  for (let j = 0; j <= 290; j++) {
    const f = 0.6 + j * 0.01;
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
      re += detrended[k]! * hann * Math.cos((2 * Math.PI * f * k) / rateHz);
      im -= detrended[k]! * hann * Math.sin((2 * Math.PI * f * k) / rateHz);
    }
    powers.push({ f, p: re * re + im * im });
  }
  const peak = powers.reduce((best, bin) => (bin.p > best.p ? bin : best));
  const sorted = powers.map((bin) => bin.p).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return { bpm: peak.f * 60, snrDb: 10 * Math.log10(peak.p / median) };
}

// The 64 Hz inverted-red signal the estimator should analyse: last 10 s, DSP-2 spline, longest segment.
function longestInvertedRed(samples: Sample[]): Float64Array {
  const lastNs = samples[samples.length - 1]!.tNs;
  const recent = samples.filter((sample) => sample.tNs >= lastNs - 10e9);
  const tS = Float64Array.from(recent, (sample) => (sample.tNs - recent[0]!.tNs) / 1e9);
  const ppg = Float64Array.from(recent, (sample) => -sample.r);
  const segments = resampleCubic(tS, ppg, DSP_CONFIG.dsp2.modelRateHz);
  return segments.reduce((longest, segment) =>
    segment.values.length >= longest.values.length ? segment : longest,
  ).values;
}

describe('live heart rate for the Lab screen (M0 proof method)', () => {
  it.each([30, 60])('finds a clean 72 bpm pulse within ±1 bpm at %i fps with timestamp jitter', (fps) => {
    const samples = samplesAt(jitteredOffsets(fps, 10, SAMPLE_JITTER_S), pulseRed(72));
    const estimate = estimateLiveHeartRate(samples);
    expect(estimate).not.toBeNull();
    expect(Math.abs(estimate!.bpm - 72)).toBeLessThanOrEqual(1);
    expect(estimate!.snrDb).toBeGreaterThanOrEqual(6);
  });

  it('uses only the last 10 s of a longer input', () => {
    const fast = pulseRed(120);
    const slow = pulseRed(72);
    const samples = samplesAt(jitteredOffsets(30, 30, SAMPLE_JITTER_S), (tS) =>
      tS < 20 ? fast(tS) : slow(tS),
    );
    expect(Math.abs(estimateLiveHeartRate(samples)!.bpm - 72)).toBeLessThanOrEqual(1);
  });

  it('returns null without enough data or without any pulse', () => {
    expect(estimateLiveHeartRate([])).toBeNull();
    expect(estimateLiveHeartRate(samplesAt(regularOffsets(30, 7), pulseRed(72)))).toBeNull();
    expect(
      estimateLiveHeartRate(samplesAt(regularOffsets(30, 10), () => ({ r: 0.6, g: 0.1, b: 0.05 }))),
    ).toBeNull();
    // A black frame: every bin's power is exactly 0, so the SNR is 0/0.
    expect(estimateLiveHeartRate(samplesAt(regularOffsets(30, 10), () => ({ r: 0, g: 0, b: 0 })))).toBeNull();
  });

  it('works on the longest segment when a 200 ms gap still leaves at least 8 s', () => {
    // Gap from 1.0 to 1.2 s: the segment after it is about 8.8 s.
    const samples = samplesAt(offsetsWithGap(30, 10, 1.0, 0.2), pulseRed(72));
    expect(Math.abs(estimateLiveHeartRate(samples)!.bpm - 72)).toBeLessThanOrEqual(1);
  });

  it('returns null when a 200 ms gap leaves no segment of 8 s', () => {
    // Gap from 5.0 to 5.2 s: neither side reaches 5 s.
    expect(estimateLiveHeartRate(samplesAt(offsetsWithGap(30, 10, 5.0, 0.2), pulseRed(72)))).toBeNull();
  });

  it('interpolates across a 133 ms gap (frames 5.0 → 5.133 s) instead of splitting at it', () => {
    const samples = samplesAt(offsetsWithGap(30, 10, 5.0, 0.12), pulseRed(72));
    expect(Math.abs(estimateLiveHeartRate(samples)!.bpm - 72)).toBeLessThanOrEqual(1);
  });

  it.each([35, 190])('returns null for a %i bpm pulse, outside 40–180', (bpm) => {
    expect(
      estimateLiveHeartRate(samplesAt(jitteredOffsets(30, 10, SAMPLE_JITTER_S), sineRed(bpm))),
    ).toBeNull();
  });

  it.each([
    ['one contiguous 10 s window', jitteredOffsets(30, 10, SAMPLE_JITTER_S)],
    ['the longest segment after a gap', offsetsWithGap(30, 10, 0.8, 0.3)],
  ])('matches a direct transcription of the proof spectrum on %s', (_label, offsetsS) => {
    const samples = samplesAt(offsetsS, pulseRed(84));
    const reference = referenceSpectrum(longestInvertedRed(samples), DSP_CONFIG.dsp2.modelRateHz);
    const estimate = estimateLiveHeartRate(samples)!;
    expect(estimate.bpm).toBeCloseTo(reference.bpm, 9);
    expect(estimate.snrDb).toBeCloseTo(reference.snrDb, 9);
  });

  // §9.3 allows < 5 ms of JS per 100 ms batch; this runs once a second, so holding one call to the same
  // 5 ms is conservative. The median ignores garbage-collection pauses on a shared CI runner.
  it('takes under 5 ms per call (median) on 10 s at 60 fps', () => {
    const samples = samplesAt(jitteredOffsets(60, 10, SAMPLE_JITTER_S), pulseRed(72));
    for (let call = 0; call < 20; call++) estimateLiveHeartRate(samples);
    const callMs = Array.from({ length: 101 }, () => {
      const startMs = performance.now();
      estimateLiveHeartRate(samples);
      return performance.now() - startMs;
    }).sort((a, b) => a - b);
    expect(callMs[50]).toBeLessThan(5);
  });
});
