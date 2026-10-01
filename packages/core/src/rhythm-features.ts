import { DSP_CONFIG } from './config';

// Every sum runs in index order so ml/lumen_dsp/rhythm.py, which uses the same loops, gives the same
// doubles (§10.2 parity).

export interface RhythmWindow {
  startInterval: number; // index of the window's first interval in the reading
  intervalsS: number[];
  normalizedRmssd: number; // RMSSD / mean interval
  shannonEntropyBits: number;
  turningPointRatio: number; // turning points / (n − 2); ties are not turning points
  sd1S: number;
  sd2S: number;
  sd1Sd2Ratio: number | null; // null when SD2 is 0
  pnn50: number;
  sampleEntropy: number | null; // null when no template pairs match at length m or m + 1
  atypicalFraction: number; // atypical beats among the n + 1 beats that bound the window
}

function sum(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

// Population SD (divide by n). Exactly 0 when all values are equal, so "undefined" cases stay exact.
function populationSd(values: number[]): number {
  if (values.every((value) => value === values[0])) return 0;
  const mean = sum(values) / values.length;
  return Math.sqrt(sum(values.map((value) => (value - mean) ** 2)) / values.length);
}

// 16 equal-width bins over [min, max]; the maximum falls in the last bin. log base 2.
function shannonEntropyBits(intervalsS: number[]): number {
  const { histogramBins } = DSP_CONFIG.dsp15;
  const low = Math.min(...intervalsS);
  const high = Math.max(...intervalsS);
  const counts = new Array<number>(histogramBins).fill(0);
  for (const value of intervalsS) {
    const bin =
      high === low
        ? 0
        : Math.min(histogramBins - 1, Math.floor(((value - low) / (high - low)) * histogramBins));
    counts[bin]!++;
  }
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const probability = count / intervalsS.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

// Richman & Moorman (2000): r = R · population SD, Chebyshev distance ≤ r, self-matches excluded, and the
// same first N − m templates for lengths m and m + 1. SampEn = ln(B / A).
function sampleEntropy(intervalsS: number[]): number | null {
  const { sampleEntropyM: m, sampleEntropyR } = DSP_CONFIG.dsp15;
  const r = sampleEntropyR * populationSd(intervalsS);
  const templates = intervalsS.length - m;
  const matchingPairs = (length: number) => {
    let count = 0;
    for (let i = 0; i < templates; i++) {
      for (let j = i + 1; j < templates; j++) {
        let within = true;
        for (let k = 0; k < length && within; k++)
          within = Math.abs(intervalsS[i + k]! - intervalsS[j + k]!) <= r;
        if (within) count++;
      }
    }
    return count;
  };
  const shorter = matchingPairs(m);
  const longer = matchingPairs(m + 1);
  return shorter === 0 || longer === 0 ? null : Math.log(shorter / longer);
}

function windowFeatures(startInterval: number, intervalsS: number[], atypicalBeats: boolean[]): RhythmWindow {
  const n = intervalsS.length;
  const differences = intervalsS.slice(1).map((value, i) => value - intervalsS[i]!);
  const mean = sum(intervalsS) / n;
  const rmssd = Math.sqrt(sum(differences.map((difference) => difference * difference)) / differences.length);

  let turningPoints = 0;
  for (let i = 1; i < n - 1; i++) if (differences[i - 1]! * differences[i]! < 0) turningPoints++;

  const sd1S = populationSd(differences.map((difference) => difference / Math.SQRT2));
  const sd2S = populationSd(intervalsS.slice(1).map((value, i) => (value + intervalsS[i]!) / Math.SQRT2));
  const overThreshold = differences.filter(
    (difference) => Math.abs(difference) > DSP_CONFIG.dsp15.pnnThresholdS,
  );
  const boundingBeats = atypicalBeats.slice(startInterval, startInterval + n + 1);

  return {
    startInterval,
    intervalsS,
    normalizedRmssd: rmssd / mean,
    shannonEntropyBits: shannonEntropyBits(intervalsS),
    turningPointRatio: turningPoints / (n - 2),
    sd1S,
    sd2S,
    sd1Sd2Ratio: sd2S === 0 ? null : sd1S / sd2S,
    pnn50: overThreshold.length / differences.length,
    sampleEntropy: sampleEntropy(intervalsS),
    atypicalFraction: boundingBeats.filter(Boolean).length / boundingBeats.length,
  };
}

/** DSP-15: rhythm features per 32-interval window (step 16) within each run of usable intervals. */
export function rhythmWindows(
  intervalsS: number[],
  spansArtifact: boolean[],
  atypicalBeats: boolean[],
): RhythmWindow[] {
  if (spansArtifact.length !== intervalsS.length)
    throw new RangeError(`${intervalsS.length} intervals but ${spansArtifact.length} artifact flags`);
  if (atypicalBeats.length !== intervalsS.length + 1)
    throw new RangeError(
      `${intervalsS.length} intervals need ${intervalsS.length + 1} beat flags, got ${atypicalBeats.length}`,
    );
  const { windowIntervals, windowStep } = DSP_CONFIG.dsp15;
  const windows: RhythmWindow[] = [];
  // An excluded interval ends the run: successive differences, turning points, Poincaré pairs, and
  // sample-entropy templates must only pair intervals that are really adjacent in time.
  for (let runStart = 0; runStart < intervalsS.length;) {
    if (spansArtifact[runStart]) {
      runStart++;
      continue;
    }
    let runEnd = runStart;
    while (runEnd < intervalsS.length && !spansArtifact[runEnd]) runEnd++;
    for (let start = runStart; start + windowIntervals <= runEnd; start += windowStep) {
      windows.push(windowFeatures(start, intervalsS.slice(start, start + windowIntervals), atypicalBeats));
    }
    runStart = runEnd;
  }
  return windows;
}

/** DSP-15: a reading needs at least 40 intervals that do not span an artifact. */
export function hasEnoughUsableIntervals(spansArtifact: boolean[]): boolean {
  return spansArtifact.filter((spans) => !spans).length >= DSP_CONFIG.dsp15.minUsableIntervals;
}
