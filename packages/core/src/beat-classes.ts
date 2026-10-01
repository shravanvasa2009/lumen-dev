import type { DetectedBeat } from './beats';
import { DSP_CONFIG } from './config';
import type { BeatClass, ClassifiedBeat, RejectedSpan } from './live-session';
import { median } from './median';
import type { ResampledSegment } from './resample';

// Pearson correlation; null when either side is flat, since a flat window carries no shape evidence.
function correlation(x: Float64Array, y: Float64Array): number | null {
  let meanX = 0;
  let meanY = 0;
  for (let k = 0; k < x.length; k++) {
    meanX += x[k]!;
    meanY += y[k]!;
  }
  meanX /= x.length;
  meanY /= y.length;
  let cross = 0;
  let squaresX = 0;
  let squaresY = 0;
  for (let k = 0; k < x.length; k++) {
    const dx = x[k]! - meanX;
    const dy = y[k]! - meanY;
    cross += dx * dy;
    squaresX += dx * dx;
    squaresY += dy * dy;
  }
  return squaresX > 0 && squaresY > 0 ? cross / Math.sqrt(squaresX * squaresY) : null;
}

function pointwise(windows: Float64Array[], combine: (column: number[]) => number): Float64Array {
  return Float64Array.from(windows[0]!, (_, k) => combine(windows.map((window) => window[k]!)));
}

const mean = (column: number[]) => column.reduce((sum, value) => sum + value, 0) / column.length;

// Up to `count` items on each side of position p, without p itself.
function neighboursOf<T>(items: T[], p: number, count: number): T[] {
  return [...items.slice(Math.max(0, p - count), p), ...items.slice(p + 1, p + 1 + count)];
}

/**
 * DSP-9: class and long-pause flag for each beat of one segment; acquisition evidence comes only from
 * the rejected spans and impossible intervals, never from interval irregularity.
 */
export function classifyBeats(
  beats: DetectedBeat[],
  shape: ResampledSegment,
  rejectedSpans: RejectedSpan[],
): ClassifiedBeat[] {
  const config = DSP_CONFIG.dsp9;
  const { shapeRateHz } = DSP_CONFIG.dsp2;
  const [shortestS, longestS] = config.intervalRangeS as [number, number];
  const [smallest, largest] = config.amplitudeRatioRange as [number, number];
  const overlapsSpan = (startS: number, endS: number) =>
    rejectedSpans.some((span) => span.startS <= endS && span.endS >= startS);

  // Median over every candidate of the segment, including the ones the rule will remove.
  const upslopeFloor = config.notABeatUpslopeRatio * median(beats.map((beat) => beat.maxUpslope));
  const classes: BeatClass[] = beats.map((beat) =>
    beat.maxUpslope < upslopeFloor ? 'not-a-beat' : 'normal',
  );

  // Dicrotic rule (H-016): a smaller candidate soon after the previous beat whose foot never returned
  // to baseline rides on that beat's falling side. The previous beat is the last one not removed.
  let priorBeat: number | null = null;
  beats.forEach((beat, i) => {
    if (classes[i] === 'not-a-beat') return;
    const prior = priorBeat === null ? null : beats[priorBeat]!;
    const ridesOnPrior =
      prior !== null &&
      beat.peakS - prior.peakS <= config.dicroticWindowS &&
      beat.footValue > prior.footValue + config.dicroticFootRise * prior.amplitude &&
      beat.amplitude < prior.amplitude;
    if (ridesOnPrior) classes[i] = 'not-a-beat';
    else priorBeat = i;
  });

  // Intervals run between consecutive beats that are not "not a beat"; the first beat has none.
  const previousBeat: (number | null)[] = [];
  let lastBeat: number | null = null;
  beats.forEach((beat, i) => {
    previousBeat.push(lastBeat);
    if (classes[i] !== 'not-a-beat') lastBeat = i;
  });

  beats.forEach((beat, i) => {
    if (classes[i] === 'not-a-beat') return;
    const previous = previousBeat[i];
    const intervalS = previous == null ? null : beat.peakS - beats[previous]!.peakS;
    const impossible = intervalS !== null && (intervalS < shortestS || intervalS > longestS);
    if (overlapsSpan(beat.onsetS ?? beat.peakS, beat.peakS) || impossible) classes[i] = 'artifact';
  });

  const beforePeak = Math.round(config.templateBeforePeakS * shapeRateHz);
  const afterPeak = Math.round(config.templateAfterPeakS * shapeRateHz);
  const windowOf = (beat: DetectedBeat) => {
    const peak = Math.round(beat.peakS * shapeRateHz) - shape.firstIndex;
    if (peak - beforePeak < 0 || peak + afterPeak >= shape.values.length) return null;
    return shape.values.slice(peak - beforePeak, peak + afterPeak + 1);
  };

  // "Early" (H-016): the interval to the previous beat is short against the median of up to `neighbours`
  // intervals on each side, all between consecutive beats that are not "not a beat".
  const kept = beats.flatMap((_, i) => (classes[i] !== 'not-a-beat' ? [i] : []));
  const keptIntervals = kept.map((i, q) => (q === 0 ? null : beats[i]!.peakS - beats[kept[q - 1]!]!.peakS));
  const earlyBeats = new Set<number>();
  kept.forEach((i, q) => {
    const ownS = keptIntervals[q];
    if (ownS == null) return;
    const others = neighboursOf(keptIntervals, q, config.neighbours).filter(
      (intervalS) => intervalS !== null,
    );
    if (ownS < config.earlyIntervalRatio * median(others)) earlyBeats.add(i);
  });

  const candidates = beats.flatMap((_, i) => (classes[i] === 'normal' ? [i] : []));
  const windows = candidates.map((i) => windowOf(beats[i]!));
  // Before any normal beat exists, the template is the pointwise median of the first windows, so one
  // early premature beat cannot become the reference.
  const seedWindows = windows.filter((window) => window !== null).slice(0, config.templateBeats);
  const normalWindows: Float64Array[] = [];
  candidates.forEach((i, p) => {
    const reference = median(neighboursOf(candidates, p, config.neighbours).map((j) => beats[j]!.amplitude));
    const ratio = beats[i]!.amplitude / reference;
    const window = windows[p]!;
    const template =
      normalWindows.length > 0
        ? pointwise(normalWindows.slice(-config.templateBeats), mean)
        : seedWindows.length > 0
          ? pointwise(seedWindows, median)
          : null;
    const similarity = window && template ? correlation(window, template) : null;
    // A missing reference or window is no evidence either way.
    const oddSize = Number.isFinite(ratio) && (ratio < smallest || ratio > largest);
    const oddShape = similarity !== null && similarity < config.templateCorrelationMin;
    // Kept as atypical, never removed: the interval only decides together with a small amplitude.
    const earlyAndSmall =
      earlyBeats.has(i) && Number.isFinite(ratio) && ratio < config.earlySmallAmplitudeRatio;
    if (oddSize || oddShape || earlyAndSmall) classes[i] = 'atypical';
    else if (window) normalWindows.push(window);
  });

  // Long-pause references: intervals with no acquisition problem at either end or inside.
  const cleanIntervals: { end: number; lengthS: number }[] = [];
  beats.forEach((beat, i) => {
    const start = previousBeat[i];
    if (start == null || classes[i] === 'not-a-beat' || classes[i] === 'artifact') return;
    if (classes[start] === 'artifact' || overlapsSpan(beats[start]!.peakS, beat.peakS)) return;
    cleanIntervals.push({ end: i, lengthS: beat.peakS - beats[start]!.peakS });
  });
  const longPauses = new Set<number>();
  cleanIntervals.forEach(({ end, lengthS }, q) => {
    const reference = median(neighboursOf(cleanIntervals, q, config.neighbours).map((n) => n.lengthS));
    if (lengthS >= config.longPauseRatio * reference) longPauses.add(end);
  });

  return beats.map((beat, i) => ({
    peakS: beat.peakS,
    onsetS: beat.onsetS,
    beatClass: classes[i]!,
    longPause: longPauses.has(i),
  }));
}
