import { elgendiWindows, type DetectedBeat } from './beats';
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

// 2 × count items around position p, without p itself: count on each side, and at either end the window
// shifts inward so it keeps 2 × count items. An even, balanced window lets alternating rhythms (bigeminy,
// trigeminy) represent every beat kind in the median (red-team v2, ADR 0025).
function neighboursOf<T>(items: T[], p: number, count: number): T[] {
  const start = Math.max(0, Math.min(p - count, items.length - 1 - 2 * count));
  const end = Math.min(items.length, start + 2 * count + 1);
  return [...items.slice(start, p), ...items.slice(p + 1, end)];
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
  const [shortestS, longestS] = config.artifactIntervalS as [number, number];
  const [smallest, largest] = config.amplitudeRatioRange as [number, number];
  const overlapsSpan = (startS: number, endS: number) =>
    rejectedSpans.some((span) => span.startS <= endS && span.endS >= startS);
  // A NaN fails every comparison, so such a beat would pass every rule as normal; refuse it (red-team v2).
  beats.forEach((beat, i) => {
    if (![beat.peakS, beat.maxUpslope, beat.amplitude, beat.onsetS ?? 0].every(Number.isFinite))
      throw new RangeError(`beat ${i} has a non-finite time, upslope, or amplitude`);
  });
  const inSpan = (beat: DetectedBeat) => overlapsSpan(beat.onsetS ?? beat.peakS, beat.peakS);

  // Median over the candidates outside rejected spans, including the ones the rule will remove; motion
  // upslopes would otherwise raise the floor over clean beats (red-team v2). All candidates if none qualify.
  const cleanUpslopes = beats.filter((beat) => !inSpan(beat)).map((beat) => beat.maxUpslope);
  const upslopeFloor =
    config.notABeatUpslopeRatio *
    median(cleanUpslopes.length > 0 ? cleanUpslopes : beats.map((beat) => beat.maxUpslope));
  const classes: BeatClass[] = beats.map((beat) =>
    beat.maxUpslope < upslopeFloor ? 'not-a-beat' : 'normal',
  );

  // Intervals run between consecutive beats that are not "not a beat"; the first beat has none.
  const previousBeat: (number | null)[] = [];
  let lastBeat: number | null = null;
  beats.forEach((_, i) => {
    previousBeat.push(lastBeat);
    if (classes[i] !== 'not-a-beat') lastBeat = i;
  });

  beats.forEach((beat, i) => {
    if (classes[i] === 'not-a-beat') return;
    const previous = previousBeat[i];
    const intervalS = previous == null ? null : beat.peakS - beats[previous]!.peakS;
    const impossible = intervalS !== null && (intervalS < shortestS || intervalS > longestS);
    if (inSpan(beat) || impossible) classes[i] = 'artifact';
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
  // A beat whose foot was not observed (onset null) has an unreliable amplitude and window: it never
  // serves as an amplitude or template reference (red-team v2).
  const footSeen = (i: number) => beats[i]!.onsetS !== null;
  // Before any normal beat exists, the template is the pointwise median of the first windows, so one
  // early premature beat cannot become the reference.
  const seedWindows = windows
    .flatMap((window, p) => (window !== null && footSeen(candidates[p]!) ? [window] : []))
    .slice(0, config.templateBeats);
  const normalWindows: Float64Array[] = [];
  candidates.forEach((i, p) => {
    const reference = median(
      neighboursOf(candidates, p, config.neighbours)
        .filter(footSeen)
        .map((j) => beats[j]!.amplitude),
    );
    const ratio = beats[i]!.amplitude / reference;
    const window = windows[p] ?? null;
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
    else if (window && footSeen(i)) normalWindows.push(window);
  });

  // Long-pause references: intervals with no acquisition problem at either end or inside, and neither end
  // at a segment edge, where a spurious candidate or an unseen foot would fake a pause (red-team v2): the
  // first candidate when its DSP-8 foot search was cut by the segment start, or a peak within half of W2
  // of the segment end, where Elgendi's MA_beat runs past the signal (counted as zeros) and lowers THR1.
  const minimumSearch = Math.round(DSP_CONFIG.dsp8.minimumSearchS * shapeRateHz);
  const endMargin = (elgendiWindows(shapeRateHz).beatSamples - 1) / 2;
  const nearSegmentEdge = (i: number) => {
    const peak = Math.round(beats[i]!.peakS * shapeRateHz) - shape.firstIndex;
    return (i === 0 && peak < minimumSearch) || peak > shape.values.length - 1 - endMargin;
  };
  const cleanIntervals: { end: number; lengthS: number }[] = [];
  beats.forEach((beat, i) => {
    const start = previousBeat[i];
    if (start == null || classes[i] === 'not-a-beat' || classes[i] === 'artifact') return;
    if (classes[start] === 'artifact' || overlapsSpan(beats[start]!.peakS, beat.peakS)) return;
    if (nearSegmentEdge(i) || nearSegmentEdge(start)) return;
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
