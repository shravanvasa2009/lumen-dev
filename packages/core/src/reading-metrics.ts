import type { DetectedBeat } from './beats';
import { DSP_CONFIG } from './config';
import { dcLevel } from './finger-signal';
import type { ClassifiedBeat, RejectedSpan } from './live-session';
import { median } from './median';
import type { ResampledSegment } from './resample';
import type { ReadingRhythm } from './results';

// Readings arrive as one beat list per DSP-2 segment (classifyBeats output); no interval ever spans two
// segments, since the gap between them may hide beats. Every clean-seconds and fps gate is written as
// !(value >= floor) so that NaN fails it. Sums run in index order so ml/lumen_dsp/metrics.py
// gives the same doubles.

export interface MeasuredBeat extends ClassifiedBeat {
  amplitude: number; // DSP-8 peak minus onset level (the preceding minimum), morphology band
  intensity: number; // raw −R at the peak: the DSP-13 intensity (baseline) series
  dc: number; // DSP-3 DC level of −R at the peak; negative because −R is negative
}

export interface Hrv {
  rmssdMs: number | null;
  sdnnMs: number | null;
  pnn50: number | null; // fraction of successive differences over 50 ms
  nnIntervals: number; // NN intervals left after the 20% filter
}

/** Clean seconds: time in [startS, endS] not covered by any rejected span (overlaps counted once). */
export function cleanSeconds(startS: number, endS: number, rejectedSpans: RejectedSpan[]): number {
  const clipped = rejectedSpans
    .map((span) => [Math.max(span.startS, startS), Math.min(span.endS, endS)] as const)
    .filter(([from, to]) => to > from)
    .sort((x, y) => x[0] - y[0]);
  let lostS = 0;
  let coveredTo = startS;
  for (const [from, to] of clipped) {
    if (to <= coveredTo) continue;
    lostS += to - Math.max(from, coveredTo);
    coveredTo = to;
  }
  return endS - startS - lostS;
}

/** DSP-10/13: amplitude, raw intensity, and DSP-3 DC per beat of one segment; raw is the 256 Hz −R. */
export function measureBeats(
  detected: DetectedBeat[],
  classified: ClassifiedBeat[],
  raw: ResampledSegment,
): MeasuredBeat[] {
  if (detected.length !== classified.length)
    throw new RangeError(`${detected.length} detected beats but ${classified.length} classified`);
  const { shapeRateHz } = DSP_CONFIG.dsp2;
  const dc = dcLevel(raw.values, shapeRateHz);
  const last = raw.values.length - 1;
  return classified.map((beat, i) => {
    const sample = Math.min(last, Math.max(0, Math.round(beat.peakS * shapeRateHz) - raw.firstIndex));
    return { ...beat, amplitude: detected[i]!.amplitude, intensity: raw.values[sample]!, dc: dc[sample]! };
  });
}

/** DSP-10: perfusion index in percent, the median over normal beats of amplitude / |DC|. */
export function perfusionIndex(segments: MeasuredBeat[][], cleanS: number): number | null {
  if (!(cleanS >= DSP_CONFIG.dsp10.minCleanS)) return null;
  const ratios = segments
    .flat()
    .filter((beat) => beat.beatClass === 'normal')
    .map((beat) => (100 * beat.amplitude) / Math.abs(beat.dc));
  return ratios.length > 0 ? median(ratios) : null;
}

// Consecutive beat pairs of one segment, "not a beat" candidates left out (they are not beats).
function beatPairs<T extends ClassifiedBeat>(segment: T[]): [T, T][] {
  const beats = segment.filter((beat) => beat.beatClass !== 'not-a-beat');
  return beats.slice(1).map((beat, i) => [beats[i]!, beat]);
}

/** DSP-11: heart rate in bpm, 60 / the median interval between consecutive non-artifact beats. */
export function heartRate(segments: ClassifiedBeat[][], cleanS: number): number | null {
  if (!(cleanS >= DSP_CONFIG.dsp11.minCleanS)) return null;
  const intervalsS = segments.flatMap((segment) =>
    beatPairs(segment)
      .filter(([from, to]) => from.beatClass !== 'artifact' && to.beatClass !== 'artifact')
      .map(([from, to]) => to.peakS - from.peakS)
      // Two beats at the same or reversed times are one beat found twice, not a cardiac cycle.
      .filter((intervalS) => intervalS > 0),
  );
  return intervalsS.length > 0 ? 60 / median(intervalsS) : null;
}

// Runs of adjacent NN intervals: normal → normal, the second not ending a long pause. Anything else ends
// the run, so successive differences only pair intervals that share a beat.
function nnRuns(segments: ClassifiedBeat[][]): number[][] {
  const runs: number[][] = [];
  for (const segment of segments) {
    let run: number[] = [];
    for (const [from, to] of beatPairs(segment)) {
      if (from.beatClass === 'normal' && to.beatClass === 'normal' && !to.longPause) {
        run.push(to.peakS - from.peakS);
        continue;
      }
      if (run.length > 0) runs.push(run);
      run = [];
    }
    if (run.length > 0) runs.push(run);
  }
  return runs;
}

// The 20% filter: the reference is the median of up to `neighbours` NN intervals on each side in reading
// order (before filtering, itself excluded). A dropped interval splits its run.
function filteredRuns(runs: number[][]): number[][] {
  const { neighbours, maxNeighbourDeviation } = DSP_CONFIG.dsp12;
  const all = runs.flat();
  const kept: number[][] = [];
  let position = 0;
  for (const run of runs) {
    let current: number[] = [];
    for (const intervalS of run) {
      const reference = median([
        ...all.slice(Math.max(0, position - neighbours), position),
        ...all.slice(position + 1, position + 1 + neighbours),
      ]);
      position++;
      if (Math.abs(intervalS - reference) > maxNeighbourDeviation * reference) {
        if (current.length > 0) kept.push(current);
        current = [];
        continue;
      }
      current.push(intervalS);
    }
    if (current.length > 0) kept.push(current);
  }
  return kept;
}

// Null unless the rhythm is sinus and the capture format runs at ≥ 60 fps; each value is also null below
// its own clean-data floor.
/** DSP-12: RMSSD, SDNN, and pNN50 from NN intervals. */
export function hrv(
  segments: ClassifiedBeat[][],
  rhythm: ReadingRhythm | null, // null: no rhythm card
  captureFps: number,
  cleanS: number,
): Hrv | null {
  const config = DSP_CONFIG.dsp12;
  // A capture format has a finite rate: +Infinity fails like NaN.
  if (rhythm !== 'sinus' || !(Number.isFinite(captureFps) && captureFps >= config.minFps)) return null;
  const runs = filteredRuns(nnRuns(segments));
  const intervalsS = runs.flat();
  const differences = runs.flatMap((run) => run.slice(1).map((intervalS, i) => intervalS - run[i]!));

  const enough = cleanS >= config.rmssdMinCleanS && intervalsS.length >= config.rmssdMinIntervals;
  let squares = 0;
  for (const difference of differences) squares += difference * difference;
  const withDifferences = enough && differences.length > 0;
  const rmssdMs = withDifferences ? 1000 * Math.sqrt(squares / differences.length) : null;
  const over = differences.filter((difference) => Math.abs(difference) > config.pnnThresholdS).length;
  const pnn50 = withDifferences ? over / differences.length : null;

  let sdnnMs: number | null = null;
  if (enough && cleanS >= config.sdnnMinCleanS) {
    let total = 0;
    for (const intervalS of intervalsS) total += intervalS;
    const mean = total / intervalsS.length;
    let deviations = 0;
    for (const intervalS of intervalsS) deviations += (intervalS - mean) ** 2;
    // Sample SD (n − 1) (ADR 0040).
    sdnnMs = 1000 * Math.sqrt(deviations / (intervalsS.length - 1));
  }
  return { rmssdMs, sdnnMs, pnn50, nnIntervals: intervalsS.length };
}

// The order is diabetes-net's [1, 4] input; null values get the model's training median, not a core fill.
/** ML-6: diabetes-net's HR/HRV summary [HR bpm, RMSSD ms, SDNN ms, pNN50] by DSP-11 and DSP-12. */
export function hrSummary(
  segments: ClassifiedBeat[][],
  rhythm: ReadingRhythm | null, // null: no rhythm card
  captureFps: number,
  cleanS: number,
): (number | null)[] {
  const variability = hrv(segments, rhythm, captureFps, cleanS);
  return [
    heartRate(segments, cleanS),
    variability?.rmssdMs ?? null,
    variability?.sdnnMs ?? null,
    variability?.pnn50 ?? null,
  ];
}
