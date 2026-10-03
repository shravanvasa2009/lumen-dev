import { detectBeats, DSP_CONFIG, elgendiPeaks, elgendiWindows, upstroke, type DetectedBeat } from '../src';
import {
  detect,
  parkMillerUniforms,
  regularBeats,
  withPrematureBeats,
  type SyntheticBeat,
} from './synthetic';

const { shapeRateHz } = DSP_CONFIG.dsp2;
const { beta } = DSP_CONFIG.dsp7;

// For each true beat, the detection nearest to it and how far away it is.
function nearestErrors(detected: DetectedBeat[], beats: SyntheticBeat[]): number[] {
  return beats.map(({ peakS }) => Math.min(...detected.map((beat) => Math.abs(beat.peakS - peakS))));
}

function detectionsAwayFrom(
  detected: DetectedBeat[],
  beats: SyntheticBeat[],
  radiusS: number,
): DetectedBeat[] {
  return detected.filter((beat) => beats.every(({ peakS }) => Math.abs(beat.peakS - peakS) > radiusS));
}

describe('DSP-7 Elgendi beat detection', () => {
  it('rounds W1 = 111 ms and W2 = 667 ms to the nearest odd number of samples', () => {
    expect(elgendiWindows(64)).toEqual({ peakSamples: 7, beatSamples: 43 });
    expect(elgendiWindows(256)).toEqual({ peakSamples: 29, beatSamples: 171 });
  });

  // Tolerances come from these synthetic signals (measured 0.9 ms regular, 1.4 ms dicrotic-heavy, 3.3 ms
  // with premature beats, 7.1 ms AF-like), rounded up; each is under one 64 Hz sample (15.6 ms). The AF
  // error is the previous beat's dicrotic wave tilting the next upstroke when RR drops to 0.4 s.
  it('finds every beat of a regular 72 bpm rhythm once, within 2 ms', () => {
    const beats = regularBeats(1, 29, 72);
    const detected = detect(beats, 0.4, 30);
    expect(detected).toHaveLength(beats.length);
    expect(Math.max(...nearestErrors(detected, beats))).toBeLessThan(0.002);
  });

  it('finds every beat of a dicrotic-heavy waveform; extra detections sit only on dicrotic waves', () => {
    const beats = regularBeats(1, 29, 72);
    const detected = detect(beats, 0.9, 30);
    expect(Math.max(...nearestErrors(detected, beats))).toBeLessThan(0.002);
    // Double detections are expected here; DSP-9 ("not a beat") removes them later.
    const extras = detectionsAwayFrom(detected, beats, 0.1);
    for (const extra of extras) {
      const sinceBeat = Math.min(...beats.map(({ peakS }) => extra.peakS - peakS).filter((gapS) => gapS > 0));
      expect(sinceBeat).toBeGreaterThan(0.25);
      expect(sinceBeat).toBeLessThan(0.35);
    }
  });

  it('finds small premature beats (0.4 × amplitude, 0.6 RR) within 5 ms', () => {
    const beats = withPrematureBeats(60 / 72, 30, [8, 20, 30], 0.4);
    const detected = detect(beats, 0.4, 30);
    expect(detected).toHaveLength(beats.length);
    expect(Math.max(...nearestErrors(detected, beats))).toBeLessThan(0.005);
  });

  it('finds every beat of AF-like irregular intervals (0.4–1.2 s) within 10 ms, with no extras', () => {
    const uniforms = parkMillerUniforms(80, 4242);
    const beats: SyntheticBeat[] = [];
    for (let k = 0, peakS = 1; peakS < 28.5; peakS += 0.4 + 0.8 * uniforms[k++]!)
      beats.push({ peakS, amplitude: 1 });
    const detected = detect(beats, 0.3, 30);
    expect(detected).toHaveLength(beats.length);
    expect(Math.max(...nearestErrors(detected, beats))).toBeLessThan(0.01);
  });

  it('matches a direct transcription of the published rules on noise, including THR2 block rejection', () => {
    const uniforms = parkMillerUniforms(2000, 99);
    const noise = uniforms.map((u, n) => (u - 0.5) * (1 + Math.sin(n / 40)));
    const w1 = elgendiWindows(64).peakSamples;
    const w2 = elgendiWindows(64).beatSamples;
    const squared = noise.map((value) => (value > 0 ? value * value : 0));
    // Centered window; samples outside the signal count as zero, and the sum is divided by W.
    const centeredMean = (n: number, width: number) => {
      let sum = 0;
      for (let k = n - (width - 1) / 2; k <= n + (width - 1) / 2; k++) sum += squared[k] ?? 0;
      return sum / width;
    };
    let total = 0;
    for (const value of squared) total += value;
    const offset = beta * (total / squared.length);
    const expected: number[] = [];
    let narrowBlocks = 0;
    for (let n = 0; n < noise.length;) {
      if (!(centeredMean(n, w1) > centeredMean(n, w2) + offset)) {
        n++;
        continue;
      }
      const start = n;
      while (n < noise.length && centeredMean(n, w1) > centeredMean(n, w2) + offset) n++;
      if (n - start < w1) {
        narrowBlocks++;
        continue;
      }
      let peak = start;
      for (let k = start; k < n; k++) if (noise[k]! > noise[peak]!) peak = k;
      expected.push(peak);
    }
    expect(narrowBlocks).toBeGreaterThan(0);
    expect(elgendiPeaks(noise, 64)).toEqual(expected);
  });
});

describe('DSP-7 refinement on the 256 Hz morphology band', () => {
  it('reports times between 256 Hz samples (parabolic interpolation), not on the grid', () => {
    const beats = regularBeats(1.003, 29, 72);
    const detected = detect(beats, 0.4, 30);
    const offGrid = detected.filter(
      (beat) => Math.abs(beat.peakS * shapeRateHz - Math.round(beat.peakS * shapeRateHz)) > 1e-6,
    );
    expect(offGrid.length).toBeGreaterThan(detected.length / 2);
    expect(Math.max(...nearestErrors(detected, beats))).toBeLessThan(0.002);
  });

  // A window maximum on a slope is not a peak of the band: the parabola through it has its vertex far
  // outside the window (here about 500 samples before it), so only a local maximum is interpolated.
  it('keeps a window maximum on a slope on its sample instead of extrapolating', () => {
    const modelPeak = 40;
    const model = Float64Array.from({ length: 100 }, (_, k) => Math.max(0, 1 - Math.abs(k - modelPeak) / 5));
    const centre = 4 * modelPeak;
    const shape = Float64Array.from({ length: 400 }, (_, k) => -(k - centre) - 0.001 * (k - centre) ** 2);
    const detected = detectBeats({ firstIndex: 0, values: model }, { firstIndex: 0, values: shape });
    expect(detected.map((beat) => beat.peakS * shapeRateHz)).toEqual([centre - 4]);
  });

  // Two Elgendi blocks one 64 Hz sample apart, each with its maximum on the side facing the other, put
  // both ±1-sample refinement windows on one shared 256 Hz sample. Spikes 20 and 22 samples away lift
  // MA_beat over the one sample between the blocks.
  it('reports a peak that two candidates refine to only once', () => {
    const model = Float64Array.from({ length: 130 }, (_, k) =>
      Math.abs(k - 61) <= 16 ? 0.7 * (1 - (0.3 * Math.abs(k - 61)) / 16) : 0,
    );
    model[40] = 2;
    model[82] = 2;
    expect(elgendiPeaks(model, 64)).toEqual([40, 60, 62, 82]);
    const shared = 4 * 61;
    const shape = Float64Array.from({ length: 520 }, (_, k) => Math.exp(-0.5 * ((k - shared) / 3) ** 2));
    const peaks = detectBeats({ firstIndex: 0, values: model }, { firstIndex: 0, values: shape }).map(
      (beat) => beat.peakS * shapeRateHz,
    );
    expect(peaks.filter((peak) => Math.abs(peak - shared) <= 1)).toEqual([shared]);
    peaks.slice(1).forEach((peak, i) => expect(peak).toBeGreaterThan(peaks[i]!));
  });
});

describe('DSP-8 onset (tangent at maximum upslope meets the preceding minimum)', () => {
  it('is exact for a flat baseline followed by a straight upstroke', () => {
    // Flat at 0.2 until sample 100, rising 0.01 per sample to sample 160, then falling.
    const ramp = Array.from({ length: 300 }, (_, k) =>
      k <= 100 ? 0.2 : k <= 160 ? 0.2 + 0.01 * (k - 100) : 0.8 - 0.004 * (k - 160),
    );
    expect(upstroke(ramp, 160, 0)?.onsetIndex).toBeCloseTo(100, 9);
  });

  it('reports the maximum upslope per sample and the preceding minimum it starts from', () => {
    const valley = Array.from({ length: 200 }, (_, k) =>
      k <= 50 ? 0.5 - 0.005 * k : k <= 120 ? 0.25 + 0.02 * (k - 50) : 1.65 - 0.01 * (k - 120),
    );
    const found = upstroke(valley, 120, 10)!;
    expect(found.footIndex).toBe(50);
    expect(found.maxUpslope).toBeCloseTo(0.02, 12);
    expect(found.onsetIndex).toBeCloseTo(50, 9);
  });

  it('never searches before searchStart for the preceding minimum', () => {
    const valley = Array.from({ length: 200 }, (_, k) =>
      k <= 50 ? 0.5 - 0.005 * k : 0.25 + 0.02 * (k - 50),
    );
    expect(upstroke(valley, 120, 80)).toMatchObject({ footIndex: 80 });
  });

  it('is μ − 2σ for a Gaussian upstroke (tangent at the inflection μ − σ), within 0.5 ms', () => {
    // Inflection at μ − σ with value e^(−1/2) and slope e^(−1/2)/σ, so the tangent meets 0 at μ − 2σ.
    const muS = 1;
    const sigmaS = 0.06;
    const wave = Array.from({ length: 512 }, (_, k) =>
      Math.exp(-0.5 * ((k / shapeRateHz - muS) / sigmaS) ** 2),
    );
    const peak = Math.round(muS * shapeRateHz);
    const onsetSample = upstroke(wave, peak, peak - Math.round(0.4 * shapeRateHz))!.onsetIndex;
    expect(Math.abs(onsetSample / shapeRateHz - (muS - 2 * sigmaS))).toBeLessThan(0.0005);
  });

  it('gives no onset when nothing rises before the peak', () => {
    const falling = Array.from({ length: 100 }, (_, k) => 1 - k / 100);
    expect(upstroke(falling, 50, 0)).toBeNull();
  });

  it('places each onset of a regular rhythm 50–250 ms before its peak', () => {
    const detected = detect(regularBeats(1, 29, 72), 0.4, 30);
    for (const beat of detected) {
      expect(beat.onsetS).not.toBeNull();
      const leadS = beat.peakS - beat.onsetS!;
      expect(leadS).toBeGreaterThan(0.05);
      expect(leadS).toBeLessThan(0.25);
    }
  });
});
