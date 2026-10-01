import {
  breathingRate,
  breathingSeries,
  classifyBeats,
  detectBeats,
  DSP_CONFIG,
  measureBeats,
  welchPsd,
  type MeasuredBeat,
  type ResampledSegment,
} from '../src';
import { morphologySegment } from './synthetic';

interface Modulation {
  breathsPerMin: number;
  depth: number;
}

// Beats at `bpm` whose intensity (baseline), amplitude, and interval (RSA) each follow their own
// breathing sine; a zero depth leaves that series flat. Inspiration shortens the interval (RSA).
function breathingBeats(
  seconds: number,
  bpm: number,
  modulations: { intensity: Modulation; amplitude: Modulation; interval: Modulation },
  firstS = 1,
): MeasuredBeat[] {
  const wave = ({ breathsPerMin, depth }: Modulation, tS: number) =>
    depth * Math.sin((2 * Math.PI * breathsPerMin * tS) / 60);
  const beats: MeasuredBeat[] = [];
  for (let peakS = firstS; peakS < firstS + seconds;) {
    beats.push({
      peakS,
      onsetS: peakS - 0.1,
      beatClass: 'normal',
      longPause: false,
      amplitude: 0.004 * (1 + wave(modulations.amplitude, peakS)),
      intensity: -0.62 + wave(modulations.intensity, peakS),
      dc: -0.62,
    });
    peakS += (60 / bpm) * (1 - wave(modulations.interval, peakS));
  }
  return beats;
}

const allAt = (breathsPerMin: number) => ({
  intensity: { breathsPerMin, depth: 0.002 },
  amplitude: { breathsPerMin, depth: 0.2 },
  interval: { breathsPerMin, depth: 0.05 },
});

// The 512-point FFT grid at 4 Hz puts a bin every 0.469 br/min, so a pure tone reads within half a bin.
const HALF_BIN_BRPM = (60 * DSP_CONFIG.dsp13.seriesRateHz) / DSP_CONFIG.dsp13.welchFftSamples / 2;

describe('Welch PSD (DSP-13, scipy.signal.welch parameters)', () => {
  const { seriesRateHz, welchSegmentSamples, welchFftSamples } = DSP_CONFIG.dsp13;

  it('uses 128-sample Hann segments with 50% overlap and a 512-point FFT', () => {
    expect(welchSegmentSamples).toBe(128);
    expect(DSP_CONFIG.dsp13.welchOverlapSamples).toBe(64);
    expect(welchFftSamples).toBe(512);
    const psd = welchPsd(new Float64Array(240).map((_, k) => Math.sin(k)));
    // scipy: (n − noverlap) // step segments, trailing partial dropped.
    expect(psd.segments).toBe(2);
    expect(psd.frequenciesHz).toHaveLength(welchFftSamples / 2 + 1);
    expect(psd.frequenciesHz[1]).toBe(seriesRateHz / welchFftSamples);
    expect(psd.frequenciesHz[welchFftSamples / 2]).toBe(seriesRateHz / 2);
  });

  it('keeps the power of a sine (density scaling): the PSD integrates to A²/2', () => {
    // 0.25 Hz is 8 whole cycles per 32 s segment.
    const amplitude = 0.3;
    const series = Float64Array.from(
      { length: 400 },
      (_, k) => amplitude * Math.sin(2 * Math.PI * 0.25 * (k / seriesRateHz)),
    );
    const { psd, frequenciesHz } = welchPsd(series);
    const power = psd.reduce((sum: number, value: number) => sum + value, 0) * (seriesRateHz / welchFftSamples);
    expect(power).toBeCloseTo(amplitude ** 2 / 2, 3);
    const peak = psd.indexOf(Math.max(...psd));
    expect(frequenciesHz[peak]).toBe(0.25);
  });

  it('removes a straight line from each segment before the window (detrend "linear")', () => {
    const line = Float64Array.from({ length: 256 }, (_, k) => 3 + 0.01 * k);
    expect(Math.max(...welchPsd(line).psd)).toBeLessThan(1e-20);
  });

  it('refuses a series shorter than one segment', () => {
    expect(() => welchPsd(new Float64Array(127))).toThrow(RangeError);
  });
});

describe('DSP-13 modulation series at 4 Hz', () => {
  it('interpolates each series linearly onto the k / 4 s grid between its first and last point', () => {
    const beats = breathingBeats(70, 72, allAt(15), 1.1);
    const [intensity] = breathingSeries([beats]).intensity;
    const first = beats[0]!;
    const second = beats[1]!;
    // The first grid point at or after 1.1 s is 1.25 s (k = 5).
    expect(intensity!.firstIndex).toBe(5);
    const fraction = (1.25 - first.peakS) / (second.peakS - first.peakS);
    expect(intensity!.values[0]).toBeCloseTo(
      first.intensity + fraction * (second.intensity - first.intensity),
      12,
    );
    // The interval series starts at the second beat, which ends the first interval.
    expect(breathingSeries([beats]).interval[0]!.firstIndex).toBe(Math.ceil(second.peakS * 4));
  });

  it('skips atypical beats and long pauses as points but keeps the run; an artifact beat ends the run', () => {
    const beats = breathingBeats(120, 72, allAt(15));
    beats[30] = { ...beats[30]!, beatClass: 'atypical', amplitude: 0.001 };
    beats[40] = { ...beats[40]!, longPause: true };
    beats[80] = { ...beats[80]!, beatClass: 'artifact' };
    const series = breathingSeries([beats]);
    // One run before beat 80 and one after it, for each of the three series.
    expect(series.intensity).toHaveLength(2);
    expect(series.amplitude).toHaveLength(2);
    expect(series.interval).toHaveLength(2);
    // The atypical beat's small amplitude never enters the amplitude series.
    expect(Math.min(...series.amplitude[0]!.values)).toBeGreaterThan(0.004 * 0.8 - 1e-12);
  });

  it('never bridges two DSP-2 segments', () => {
    const first = breathingBeats(50, 72, allAt(15), 1);
    const second = breathingBeats(50, 72, allAt(15), 60);
    expect(breathingSeries([first, second]).amplitude).toHaveLength(2);
  });
});

describe('DSP-13 breathing rate', () => {
  it.each([12, 18])('reads %d br/min when all three modulations breathe at that rate', (breathsPerMin) => {
    const rate = breathingRate([breathingBeats(120, 72, allAt(breathsPerMin))], 120)!;
    for (const estimate of [rate.intensityBrpm, rate.amplitudeBrpm, rate.intervalBrpm])
      expect(Math.abs(estimate! - breathsPerMin)).toBeLessThanOrEqual(HALF_BIN_BRPM);
    expect(rate.rateBrpm).toBeCloseTo(
      (rate.intensityBrpm! + rate.amplitudeBrpm! + rate.intervalBrpm!) / 3,
      12,
    );
    expect(Math.abs(rate.rateBrpm! - breathsPerMin)).toBeLessThanOrEqual(HALF_BIN_BRPM);
  });

  it.each([
    ['baseline', 'intensity'],
    ['AM', 'amplitude'],
    ['RSA', 'interval'],
  ] as const)('finds 12 br/min from %s modulation alone', (_, key) => {
    const flat = { breathsPerMin: 12, depth: 0 };
    const modulations = { intensity: flat, amplitude: flat, interval: flat, [key]: allAt(12)[key] };
    const rate = breathingRate([breathingBeats(120, 72, modulations)], 120)!;
    expect(Math.abs(rate[`${key}Brpm`]! - 12)).toBeLessThanOrEqual(HALF_BIN_BRPM);
  });

  it('reports nothing when the three estimates spread over more than 4 br/min', () => {
    const modulations = {
      intensity: { breathsPerMin: 24, depth: 0.002 },
      amplitude: { breathsPerMin: 12, depth: 0.2 },
      interval: { breathsPerMin: 12, depth: 0.05 },
    };
    const rate = breathingRate([breathingBeats(120, 72, modulations)], 120)!;
    expect(Math.abs(rate.intensityBrpm! - 24)).toBeLessThanOrEqual(HALF_BIN_BRPM);
    expect(Math.abs(rate.amplitudeBrpm! - 12)).toBeLessThanOrEqual(HALF_BIN_BRPM);
    expect(rate.rateBrpm).toBeNull();
  });

  it('reports the mean when the spread is within 4 br/min', () => {
    const modulations = {
      intensity: { breathsPerMin: 15, depth: 0.002 },
      amplitude: { breathsPerMin: 12, depth: 0.2 },
      interval: { breathsPerMin: 12, depth: 0.05 },
    };
    const rate = breathingRate([breathingBeats(120, 72, modulations)], 120)!;
    expect(rate.rateBrpm).toBeCloseTo(
      (rate.intensityBrpm! + rate.amplitudeBrpm! + rate.intervalBrpm!) / 3,
      12,
    );
  });

  it('keeps its estimate with a premature beat that is skipped as a point', () => {
    const beats = breathingBeats(120, 72, allAt(15));
    beats[50] = { ...beats[50]!, beatClass: 'atypical', peakS: beats[50]!.peakS - 0.3, amplitude: 0.0015 };
    expect(Math.abs(breathingRate([beats], 120)!.rateBrpm! - 15)).toBeLessThanOrEqual(HALF_BIN_BRPM);
  });

  it('needs 60 clean seconds', () => {
    const beats = [breathingBeats(120, 72, allAt(15))];
    expect(DSP_CONFIG.dsp13.minCleanS).toBe(60);
    expect(breathingRate(beats, 59.9)).toBeNull();
    expect(breathingRate(beats, 60)).not.toBeNull();
  });

  it('gives no estimate when no run is 32 s long, even with 60 clean seconds', () => {
    // Runs of about 25 s, each ended by an artifact beat.
    const beats = breathingBeats(100, 72, allAt(15)).map((beat, i) =>
      i % 30 === 29 ? { ...beat, beatClass: 'artifact' as const } : beat,
    );
    expect(breathingRate([beats], 90)).toEqual({
      rateBrpm: null,
      intensityBrpm: null,
      amplitudeBrpm: null,
      intervalBrpm: null,
    });
  });

  it('reads 15 br/min end to end from a camera-like pulse with baseline, AM, and RSA breathing', () => {
    // −R at 64 and 256 Hz: Gaussian pulses (σ 60 ms) at 72 bpm with RSA 5%, height ±20%, baseline ±0.002.
    const seconds = 120;
    const breathHz = 0.25;
    const breath = (tS: number) => Math.sin(2 * Math.PI * breathHz * tS);
    const peaks: number[] = [];
    for (let peakS = 1; peakS < seconds - 1; peakS += (60 / 72) * (1 - 0.05 * breath(peakS)))
      peaks.push(peakS);
    const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
    const rawAt = (rateHz: number) =>
      Float64Array.from({ length: seconds * rateHz }, (_, k) => {
        const tS = k / rateHz;
        let pulse = 0;
        for (const peakS of peaks)
          if (Math.abs(tS - peakS) < 0.5)
            pulse += (1 + 0.2 * breath(peakS)) * Math.exp(-0.5 * ((tS - peakS) / 0.06) ** 2);
        return -0.62 + 0.004 * pulse + 0.002 * breath(tS);
      });
    const raw: ResampledSegment = { firstIndex: 0, values: rawAt(shapeRateHz) };
    const model = morphologySegment(rawAt(modelRateHz), modelRateHz);
    const shape = morphologySegment(raw.values, shapeRateHz);
    const detected = detectBeats(model, shape);
    const measured = measureBeats(detected, classifyBeats(detected, shape, []), raw);
    const rate = breathingRate([measured], seconds)!;
    for (const estimate of [rate.intensityBrpm, rate.amplitudeBrpm, rate.intervalBrpm])
      expect(Math.abs(estimate! - 15)).toBeLessThanOrEqual(HALF_BIN_BRPM);
    expect(Math.abs(rate.rateBrpm! - 15)).toBeLessThanOrEqual(HALF_BIN_BRPM);
  });
});
