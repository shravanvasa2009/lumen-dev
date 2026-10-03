import {
  analyzeReading,
  detectBeats,
  DSP_CONFIG,
  elgendiPeaks,
  elgendiWindows,
  type ReadingContext,
} from '../../src';
import {
  captureAt,
  jitteredOffsets,
  morphologySegment,
  parkMillerUniforms,
  regularOffsets,
} from '../synthetic';
import { seededNormal } from './attacks';
import cases from './fixtures/dsp7-refinement-cases.json';

// Red team (§16) for PR #147 (ADR 0068): DSP-7 refines only at a local maximum of the 256 Hz band and drops
// a candidate refining to or before the previous peak. Mirrored in ml/tests/redteam/test_dsp7_refinement.py.
// The fuzzed and clipped-peak inputs come from ml/tests/redteam/dsp7_refinement_cases.py, which also wrote
// Python's peak times into the fixture; this file rebuilds the same doubles and must match them exactly.

const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
// The refinement climbs a slope at most half of W1 from its candidate (ADR 0068).
const climbHalf = (elgendiWindows(shapeRateHz).peakSamples - 1) / 2;
const SECONDS = 12;
const KINDS = ['clean', 'noise', 'bursts', 'clipped', 'premature'] as const;

interface FuzzCase {
  seed: number;
  kind: string;
  firstModelIndex: number;
  peaksS: number[];
}
interface PlateauCase {
  kind: 'plateau';
  centre: number;
  clip: number;
  firstModelIndex: number;
  peaksS: number[];
}
const fuzzCases = (cases as (FuzzCase | PlateauCase)[]).filter((entry): entry is FuzzCase => 'seed' in entry);
const plateauCases = (cases as (FuzzCase | PlateauCase)[]).filter(
  (entry): entry is PlateauCase => entry.kind === 'plateau',
);

function parkMiller(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

// A squared raised parabola, 0 beyond its width: a pulse without exp, so both languages agree bit for bit.
function bump(x: number, riseS: number, fallS: number): number {
  const scaled = x < 0 ? x / riseS : x / fallS;
  const q = 1 - scaled * scaled;
  return q > 0 ? q * q : 0;
}

// As build_case in dsp7_refinement_cases.py, drawing the uniforms in the same order.
function fuzzInputs(seed: number) {
  const uniform = parkMiller(seed * 7919);
  const kind = KINDS[seed % KINDS.length]!;
  const rrS = 0.3 + 1.2 * uniform();
  const riseS = 0.03 + 0.07 * uniform();
  const fallS = riseS * (1 + 4 * uniform());
  const dicrotic = 0.9 * uniform();
  const delayS = 0.15 + 0.3 * uniform();
  const dicroticS = 0.04 + 0.15 * uniform();
  const prematureChance = kind === 'premature' ? 0.4 : 0.1;
  const firstModelIndex = Math.floor(uniform() * 200);

  const beats: [number, number][] = [];
  let tS = firstModelIndex / modelRateHz - 0.5 * uniform();
  while (tS < firstModelIndex / modelRateHz + SECONDS + 1) {
    const premature = uniform() < prematureChance;
    tS += premature ? rrS * (0.25 + 0.5 * uniform()) : rrS * (0.85 + 0.3 * uniform());
    beats.push([tS, 0.3 + 0.9 * uniform()]);
  }
  const noiseLevel = kind === 'noise' ? 0.3 * uniform() : 0;
  const noise = Array.from(
    { length: firstModelIndex + SECONDS * modelRateHz + 1 },
    () => noiseLevel * (2 * uniform() - 1),
  );
  const bursts: [number, number, number][] = [];
  if (kind === 'bursts')
    for (let k = 0; k < 4; k++) {
      const startS = firstModelIndex / modelRateHz + SECONDS * uniform();
      const lengthS = 0.05 + 0.4 * uniform();
      bursts.push([startS, lengthS, (uniform() - 0.5) * 8]);
    }
  const clipLevel = kind === 'clipped' ? 0.4 + 0.5 * uniform() : Infinity;

  const value = (atS: number, noiseBin: number) => {
    let total = 0;
    for (const [beatS, amplitude] of beats) {
      const x = atS - beatS;
      total += amplitude * (bump(x, riseS, fallS) + dicrotic * bump(x - delayS, dicroticS, dicroticS));
    }
    for (const [startS, lengthS, height] of bursts)
      if (startS <= atS && atS < startS + lengthS) total += height;
    total += noise[noiseBin]!;
    return Math.min(total, clipLevel);
  };
  const model = Float64Array.from({ length: SECONDS * modelRateHz }, (_, k) =>
    value((firstModelIndex + k) / modelRateHz, firstModelIndex + k),
  );
  // The noise is held over each 1/64 s, so the 256 Hz band sees the same noise in runs of 4 equal samples.
  const shape = Float64Array.from({ length: SECONDS * shapeRateHz }, (_, j) =>
    value((4 * firstModelIndex + j) / shapeRateHz, firstModelIndex + Math.floor(j / 4)),
  );
  return {
    kind,
    model: { firstIndex: firstModelIndex, values: model },
    shape: { firstIndex: 4 * firstModelIndex, values: shape },
  };
}

// A clipped peak: a parabola with its vertex at shape sample `centre`, cut flat at `clip` (build_plateau).
function plateauInputs(centre: number, clip: number) {
  const model = Float64Array.from({ length: 4 * modelRateHz }, (_, k) =>
    bump((k - 128) / modelRateHz, 0.1, 0.1),
  );
  const shape = Float64Array.from({ length: 4 * shapeRateHz }, (_, j) => {
    const offset = (j - centre) / 64;
    return Math.min(clip, 1 - offset * offset);
  });
  return { model: { firstIndex: 0, values: model }, shape: { firstIndex: 0, values: shape } };
}

const peaksOf = ({ model, shape }: ReturnType<typeof plateauInputs>) =>
  detectBeats(model, shape).map((beat) => beat.peakS);

// A refined peak lies within half of W1 (plus the parabola's half sample) of a candidate, and is either a
// local maximum of the band moved at most half a sample by the parabola, or a sample the climb had to stop
// on exactly: a segment end, or the climb limit with the band still rising.
function isRefinedPeak(values: Float64Array, index: number, centres: number[]): boolean {
  const last = values.length - 1;
  const isLocalMaximum = (k: number) =>
    k > 0 && k < last && values[k]! >= values[k - 1]! && values[k]! >= values[k + 1]!;
  return centres.some(
    (centre) =>
      Math.abs(index - centre) <= climbHalf + 0.5 &&
      [Math.floor(index), Math.ceil(index)].some(
        (sample) =>
          (Math.abs(index - sample) <= 0.5 && isLocalMaximum(sample)) ||
          (index === sample && (sample === 0 || sample === last || Math.abs(sample - centre) === climbHalf)),
      ),
  );
}

const expectIncreasing = (times: number[]) =>
  times.slice(1).forEach((time, i) => expect(time).toBeGreaterThan(times[i]!));

const gaussian = (x: number, centre: number, width: number) => Math.exp(-0.5 * ((x - centre) / width) ** 2);

function bandPair(volume: (tS: number) => number, seconds: number) {
  const sampled = (rateHz: number) =>
    morphologySegment(
      Array.from({ length: seconds * rateHz }, (_, k) => volume(k / rateHz)),
      rateHz,
    );
  return { model: sampled(modelRateHz), shape: sampled(shapeRateHz) };
}

// Parabolic vertices of the band's strict local maxima: where its peaks are, to within float error.
function bandMaximaS(values: Float64Array): number[] {
  const maxima: number[] = [];
  for (let k = 1; k < values.length - 1; k++) {
    const [before, at, after] = [values[k - 1]!, values[k]!, values[k + 1]!];
    if (at >= before && at > after)
      maxima.push((k + (0.5 * (before - after)) / (before - 2 * at + after)) / shapeRateHz);
  }
  return maxima;
}

describe('red team: DSP-7 refinement (PR #147), TypeScript against Python on shared inputs', () => {
  it('has the 80 fuzzed and 25 clipped-peak cases the generator writes', () => {
    expect(fuzzCases.map((entry) => entry.seed)).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
    expect(plateauCases).toHaveLength(25);
  });

  it.each(fuzzCases.map((entry) => [entry.seed, entry.kind, entry] as const))(
    'fuzz seed %i (%s): the same peak times as Python, strictly increasing, each a peak of the band',
    (seed, kind, entry) => {
      const inputs = fuzzInputs(seed);
      expect(inputs.kind).toBe(kind);
      const peaksS = peaksOf(inputs);
      expect(peaksS).toEqual(entry.peaksS);
      expectIncreasing(peaksS);
      const shapeFirst = inputs.shape.firstIndex;
      const centres = elgendiPeaks(inputs.model.values, modelRateHz).map(
        (peak) => Math.round(((entry.firstModelIndex + peak) / modelRateHz) * shapeRateHz) - shapeFirst,
      );
      for (const peakS of peaksS)
        expect(isRefinedPeak(inputs.shape.values, peakS * shapeRateHz - shapeFirst, centres)).toBe(true);
    },
  );

  it.each(plateauCases.map((entry) => [entry.centre, entry.clip, entry] as const))(
    'clipped peak at sample %d cut at %d: the Python time, on the flat top',
    (centre, clip, entry) => {
      const inputs = plateauInputs(centre, clip);
      const peaksS = peaksOf(inputs);
      expect(peaksS).toEqual(entry.peaksS);
      // The top is every sample equal to the maximum; a one-sample top lets the parabola move half a sample.
      // Exact plateaus cannot come through the 0.5–8 Hz band, so this does not ask where on the top it lands.
      const values = Array.from(inputs.shape.values);
      const highest = Math.max(...values);
      const top = values.flatMap((value, j) => (value === highest ? [j] : []));
      expect(peaksS).toHaveLength(1);
      expect(peaksS[0]! * shapeRateHz).toBeGreaterThanOrEqual(top[0]! - 0.5);
      expect(peaksS[0]! * shapeRateHz).toBeLessThanOrEqual(top[top.length - 1]! + 0.5);
    },
  );
});

describe('red team: DSP-7 refinement (PR #147), close and premature beats', () => {
  // Full-height premature beats (σ 30–60 ms) 0.25–0.35 s after the beat at 5 s, in a 60 bpm rhythm.
  it.each(
    [0.03, 0.04, 0.06].flatMap((sigmaS) =>
      [0.25, 0.28, 0.3, 0.32, 0.35].map((couplingS) => [sigmaS, couplingS]),
    ),
  )(
    'σ %d s, %d s after the previous beat: every candidate kept, the premature peak within 1 ms',
    (sigmaS, couplingS) => {
      const beatsS = [...Array.from({ length: 10 }, (_, i) => i + 1), 5 + couplingS];
      const { model, shape } = bandPair(
        (tS) => beatsS.reduce((sum, beatS) => sum + gaussian(tS, beatS, sigmaS), 0),
        12,
      );
      const peaksS = detectBeats(model, shape).map((beat) => beat.peakS);
      expect(elgendiPeaks(model.values, modelRateHz)).toHaveLength(11);
      expect(peaksS).toHaveLength(11);
      expect(Math.min(...peaksS.map((peakS) => Math.abs(peakS - 5 - couplingS)))).toBeLessThan(0.001);
    },
  );
});

describe('red team: DSP-7 refinement (PR #147), peak accuracy', () => {
  it('refines a candidate on the falling side of a dicrotic lobe to the lobe maximum', () => {
    // Failed at 19ea89b. 60 bpm, systolic wave σ 30 ms, dicrotic wave 0.6× at +0.3 s with σ 0.2 s, 20 s, no
    // noise. Elgendi opens a block on the falling side of the dicrotic lobe, 27 ms (8.6 samples) after its
    // maximum, so the ±4-sample window maximum is the window's first sample. 19ea89b kept that sample,
    // reporting each such beat (DSP-9 "atypical", so it enters DSP-11 and DSP-15) 11–18 ms after the lobe
    // maximum. Every reported peak must be a peak of the band, within 1 ms of one of its local maxima.
    const volume = (tS: number) => {
      let total = 0;
      for (let beat = -1; beat <= 20; beat++)
        total += gaussian(tS, beat, 0.03) + 0.6 * gaussian(tS, beat + 0.3, 0.2);
      return total;
    };
    const { model, shape } = bandPair(volume, 20);
    const maximaS = bandMaximaS(shape.values);
    const errorsMs = detectBeats(model, shape)
      .filter((beat) => beat.peakS > 1 && beat.peakS < 19)
      .map((beat) => 1000 * Math.min(...maximaS.map((maximumS) => Math.abs(beat.peakS - maximumS))));
    expect(Math.max(...errorsMs)).toBeLessThan(1);
  });
});

const context: ReadingContext = {
  captureFps: 60,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  validationRhythmLabel: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
};

describe('red team: DSP-7 refinement (PR #147), whole readings from the camera', () => {
  // A jittered sinus train (RR 0.85 s, SD 30 ms) with a skewed pulse (rise σ 30 ms, fall σ 150 ms) and a
  // 0.35× dicrotic wave, plus each acquisition attack. Peaks must increase in every segment and every
  // interval must be positive.
  const normal = seededNormal(4242);
  const beatsS: number[] = [];
  for (let tS = -2; tS < 64; tS += 0.85 + 0.03 * normal()) beatsS.push(tS);
  const volume = (tS: number) => {
    let total = 0;
    for (const beatS of beatsS) {
      const x = tS - beatS - 0.12;
      total += Math.exp(-0.5 * (x / (x < 0 ? 0.03 : 0.15)) ** 2) + 0.35 * gaussian(x, 0.3, 0.07);
    }
    return total;
  };
  const motion = parkMillerUniforms(40, 777);
  const attacks: Record<string, (tS: number) => number> = {
    clean: () => 0,
    // Six 0.2–0.6 s motion bursts, ±8 pulse heights.
    'motion bursts': (tS) =>
      [0, 1, 2, 3, 4, 5].reduce((sum, k) => {
        const startS = 5 + 9 * k + motion[3 * k]!;
        const inside = tS >= startS && tS < startS + 0.2 + 0.4 * motion[3 * k + 1]!;
        return sum + (inside ? (motion[3 * k + 2]! - 0.5) * 16 : 0);
      }, 0),
    // 100 Hz mains flicker at a fifth of the pulse, aliased by the frame rate.
    'ambient flicker': (tS) => 0.2 * Math.sin(2 * Math.PI * 100 * tS),
  };
  const fpsList = [30, 60, 120, 240];

  it.each(fpsList.flatMap((fps) => Object.keys(attacks).map((attack) => [fps, attack] as const)))(
    '%i fps, %s: peaks increase in every segment and every interval is positive',
    (fps, attack) => {
      const extra = attacks[attack]!;
      const capture = captureAt(regularOffsets(fps, 60), (tS) => ({
        r: 0.6 - 0.006 * (volume(tS) + extra(tS)),
        g: 0.1,
        b: 0.05,
      }));
      const analysis = analyzeReading(capture, { ...context, captureFps: fps });
      // About 70 beats in 60 s: the checks below must not pass on an empty reading.
      expect(analysis.segments.flat().length).toBeGreaterThan(60);
      for (const segment of analysis.segments) expectIncreasing(segment.map((beat) => beat.peakS));
      for (const interval of analysis.intervals) expect(interval.ibiMs).toBeGreaterThan(0);
    },
  );

  it.each(fpsList)('%i fps with jittered, dropped, and clipped frames: peaks increase', (fps) => {
    const kept = parkMillerUniforms(fps * 60, 31);
    // Every frame jittered ±2 ms; 3% dropped; red clipped where the pulse would push it past 0.5985.
    const offsets = jitteredOffsets(fps, 60, 0.002).filter((_, k) => k === 0 || kept[k]! > 0.03);
    const capture = captureAt(offsets, (tS) => ({
      r: Math.max(0.5985, 0.6 - 0.006 * volume(tS)),
      g: 0.1,
      b: 0.05,
    }));
    const analysis = analyzeReading(capture, { ...context, captureFps: fps });
    // About 70 beats in 60 s: the checks below must not pass on an empty reading.
    expect(analysis.segments.flat().length).toBeGreaterThan(60);
    for (const segment of analysis.segments) expectIncreasing(segment.map((beat) => beat.peakS));
    for (const interval of analysis.intervals) expect(interval.ibiMs).toBeGreaterThan(0);
  });
});
