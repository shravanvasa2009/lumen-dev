import { DSP_CONFIG } from './config';
import type { MeasuredBeat } from './reading-metrics';
import type { ResampledSegment } from './resample';

// DSP-13 follows the three respiratory modulations of Karlen et al. 2013 (IEEE TBME 60(7):1946–1953,
// doi:10.1109/TBME.2013.2246160): intensity at each peak, pulse amplitude, and pulse interval.

export interface WelchSpectrum {
  frequenciesHz: Float64Array;
  psd: Float64Array; // per Hz of the series' units squared
  segments: number;
}

export interface ModulationSeries {
  intensity: ResampledSegment[]; // on the k / 4 s grid, one per run of usable beats
  amplitude: ResampledSegment[];
  interval: ResampledSegment[];
}

export interface BreathingRate {
  rateBrpm: number | null; // the mean of the three estimates when they agree within 4 br/min
  intensityBrpm: number | null;
  amplitudeBrpm: number | null;
  intervalBrpm: number | null;
}

// Least-squares line removed, as scipy.signal.detrend(type='linear').
function detrendLinear(values: Float64Array): Float64Array {
  const n = values.length;
  const tMean = (n - 1) / 2;
  let total = 0;
  for (const value of values) total += value;
  const mean = total / n;
  let cross = 0;
  let squares = 0;
  for (let k = 0; k < n; k++) {
    cross += (k - tMean) * (values[k]! - mean);
    squares += (k - tMean) ** 2;
  }
  const slope = cross / squares;
  return values.map((value, k) => value - mean - slope * (k - tMean));
}

// Equal to scipy.signal.welch(x, fs=4, window='hann', nperseg=128, noverlap=64, nfft=512,
// detrend='linear', return_onesided=True, scaling='density', average='mean').
// https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.welch.html
/** DSP-13: Welch power spectral density of a 4 Hz modulation series. */
export function welchPsd(series: ArrayLike<number>): WelchSpectrum {
  const {
    seriesRateHz: rateHz,
    welchSegmentSamples: size,
    welchOverlapSamples: overlap,
    welchFftSamples: nfft,
  } = DSP_CONFIG.dsp13;
  if (series.length < size) throw new RangeError(`Welch needs ${size} samples, got ${series.length}`);
  // scipy's get_window('hann', N) is periodic (fftbins=True).
  const window = Float64Array.from(
    { length: size },
    (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / size),
  );
  let windowSquares = 0;
  for (const weight of window) windowSquares += weight * weight;
  const scale = 1 / (rateHz * windowSquares);
  const cosines = Float64Array.from({ length: nfft }, (_, k) => Math.cos((2 * Math.PI * k) / nfft));
  const sines = Float64Array.from({ length: nfft }, (_, k) => Math.sin((2 * Math.PI * k) / nfft));

  const bins = nfft / 2 + 1;
  const psd = new Float64Array(bins);
  const step = size - overlap;
  const segments = Math.floor((series.length - overlap) / step);
  for (let s = 0; s < segments; s++) {
    const detrended = detrendLinear(Float64Array.from({ length: size }, (_, k) => series[s * step + k]!));
    const windowed = detrended.map((value, k) => value * window[k]!);
    for (let bin = 0; bin < bins; bin++) {
      let re = 0;
      let im = 0;
      for (let k = 0; k < size; k++) {
        const angle = (bin * k) % nfft;
        re += windowed[k]! * cosines[angle]!;
        im -= windowed[k]! * sines[angle]!;
      }
      // One-sided: every bin but DC and Nyquist carries its negative-frequency twin.
      const sides = bin === 0 || bin === nfft / 2 ? 1 : 2;
      psd[bin]! += (sides * (re * re + im * im) * scale) / segments;
    }
  }
  const frequenciesHz = Float64Array.from({ length: bins }, (_, bin) => bin / (nfft / rateHz));
  return { frequenciesHz, psd, segments };
}

// Linear interpolation of (time, value) points onto k / rate between the first and last point.
function onGrid(timesS: number[], values: number[]): ResampledSegment | null {
  const { seriesRateHz: rateHz } = DSP_CONFIG.dsp13;
  if (timesS.length < 2) return null;
  const firstIndex = Math.ceil(timesS[0]! * rateHz);
  const lastIndex = Math.floor(timesS[timesS.length - 1]! * rateHz);
  if (lastIndex < firstIndex) return null;
  const grid = new Float64Array(lastIndex - firstIndex + 1);
  let j = 0;
  for (let k = 0; k < grid.length; k++) {
    const tS = (firstIndex + k) / rateHz;
    while (j < timesS.length - 2 && timesS[j + 1]! < tS) j++;
    const slope = (values[j + 1]! - values[j]!) / (timesS[j + 1]! - timesS[j]!);
    grid[k] = values[j]! + (tS - timesS[j]!) * slope;
  }
  return { firstIndex, values: grid };
}

// Runs of consecutive non-artifact beats within one segment; "not a beat" candidates are left out.
function runsOf(segment: MeasuredBeat[]): MeasuredBeat[][] {
  const runs: MeasuredBeat[][] = [[]];
  for (const beat of segment) {
    if (beat.beatClass === 'not-a-beat') continue;
    if (beat.beatClass === 'artifact') runs.push([]);
    else runs[runs.length - 1]!.push(beat);
  }
  return runs.filter((run) => run.length > 0);
}

/**
 * DSP-13: intensity, amplitude, and interval series at 4 Hz per run of non-artifact beats. Points come
 * from normal beats only; an interval point needs a normal beat at both ends and no long pause.
 */
export function breathingSeries(segments: MeasuredBeat[][]): ModulationSeries {
  const series: ModulationSeries = { intensity: [], amplitude: [], interval: [] };
  const add = (kind: keyof ModulationSeries, grid: ResampledSegment | null) =>
    grid && series[kind].push(grid);
  for (const run of segments.flatMap(runsOf)) {
    const normal = run.filter((beat) => beat.beatClass === 'normal');
    const peaksS = normal.map((beat) => beat.peakS);
    add(
      'intensity',
      onGrid(
        peaksS,
        normal.map((beat) => beat.intensity),
      ),
    );
    add(
      'amplitude',
      onGrid(
        peaksS,
        normal.map((beat) => beat.amplitude),
      ),
    );
    const ends = run.slice(1).flatMap((to, i) => {
      const from = run[i]!;
      return from.beatClass === 'normal' && to.beatClass === 'normal' && !to.longPause
        ? [{ tS: to.peakS, intervalS: to.peakS - from.peakS }]
        : [];
    });
    add(
      'interval',
      onGrid(
        ends.map((end) => end.tS),
        ends.map((end) => end.intervalS),
      ),
    );
  }
  return series;
}

// Peak of the segment-weighted mean Welch PSD over every run long enough for one segment, in br/min.
function peakBrpm(runs: ResampledSegment[]): number | null {
  const { welchSegmentSamples, bandHz } = DSP_CONFIG.dsp13;
  const [lowHz, highHz] = bandHz as [number, number];
  const spectra = runs
    .filter((run) => run.values.length >= welchSegmentSamples)
    .map((run) => welchPsd(run.values));
  if (spectra.length === 0) return null;
  let segments = 0;
  for (const spectrum of spectra) segments += spectrum.segments;
  // Pooling runs this way averages every Welch segment of the reading with equal weight.
  const { frequenciesHz } = spectra[0]!;
  let peak = -1;
  let peakPower = -Infinity;
  for (let bin = 0; bin < frequenciesHz.length; bin++) {
    if (frequenciesHz[bin]! < lowHz || frequenciesHz[bin]! > highHz) continue;
    let power = 0;
    for (const spectrum of spectra) power += (spectrum.psd[bin]! * spectrum.segments) / segments;
    if (power > peakPower) {
      peakPower = power;
      peak = bin;
    }
  }
  return 60 * frequenciesHz[peak]!;
}

/** DSP-13: breathing rate in br/min from three modulations, fused only when they agree; null < 60 clean s. */
export function breathingRate(segments: MeasuredBeat[][], cleanS: number): BreathingRate | null {
  const { minCleanS, maxSpreadBrpm } = DSP_CONFIG.dsp13;
  if (!(cleanS >= minCleanS)) return null; // NaN fails
  const series = breathingSeries(segments);
  const intensityBrpm = peakBrpm(series.intensity);
  const amplitudeBrpm = peakBrpm(series.amplitude);
  const intervalBrpm = peakBrpm(series.interval);
  let rateBrpm: number | null = null;
  if (intensityBrpm !== null && amplitudeBrpm !== null && intervalBrpm !== null) {
    const estimates = [intensityBrpm, amplitudeBrpm, intervalBrpm];
    if (Math.max(...estimates) - Math.min(...estimates) <= maxSpreadBrpm)
      rateBrpm = (intensityBrpm + amplitudeBrpm + intervalBrpm) / 3;
  }
  return { rateBrpm, intensityBrpm, amplitudeBrpm, intervalBrpm };
}
