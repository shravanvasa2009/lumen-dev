import {
  analyzeReading,
  buildReadingResult,
  buildTimebase,
  butterBandpass,
  diabetesModelInput,
  DSP_CONFIG,
  ensembleBeat,
  filterZeroPhase,
  fingerSignals,
  readingRhythm,
  rhythmModelRows,
  resampleCubic,
  SHAPE_FEATURE_NAMES,
  type MeasuredBeat,
  type ModelOutputs,
  type Profile,
  type ReadingAnalysis,
  type ReadingContext,
  type ReadingRhythm,
  type RhythmOutputs,
} from '../../src';
import seedEvidence from '../../../../docs/validation/evidence.json';
import {
  captureAt,
  jitteredOffsets,
  regularBeats,
  regularOffsets,
  withPrematureBeats,
  type SyntheticCapture,
} from '../synthetic';
import { beatTimes, beatTrain, flatRed, outcomeOf, seededNormal, sinePulse, type Channels } from './attacks';

// Red team for PR #146 (ML-6): analyzeReading's pulseShape (DSP-14 on the longest DSP-2 segment),
// readingRhythm, and diabetesModelInput. The invariants: analyzeReading never throws because of the
// pulse-shape step, every diabetes-net input value is finite or null, and the result JSON agrees with the
// analysis about whether a pulse shape exists.

const CONTEXT: ReadingContext = {
  captureFps: 60,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};
const PROFILE: Profile = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };
const NO_MODELS: ModelOutputs = { rhythm: null, diabetes: null };
const RHYTHMS: (ReadingRhythm | null)[] = ['sinus', 'af', 'other', 'uncertain', null];
const BPM = 64;

const footsOf = (seconds: number, bpm = BPM) => regularBeats(0.5, seconds - 1, bpm).map((beat) => beat.peakS);

function sinusCapture(fps: number, seconds: number, bpm = BPM, drop?: (tS: number) => boolean) {
  const offsets = regularOffsets(fps, seconds).filter((tS) => !drop?.(tS));
  return captureAt(offsets, beatTrain(footsOf(seconds, bpm)));
}

// Frames at k / fps; patch the frames where isBad(k) holds.
const patchFrames =
  (
    base: Channels,
    fps: number,
    isBad: (k: number) => boolean,
    patch: Partial<ReturnType<Channels>>,
  ): Channels =>
  (tS) => {
    const frame = base(tS);
    return isBad(Math.round(tS * fps)) ? { ...frame, ...patch } : frame;
  };

// The DSP-6 morphology band at 256 Hz of each DSP-2 segment of a capture with no broken frames, from
// exported core steps; segments shorter than dsp7.minSegmentS are dropped, as analyzeReading does.
function morphologyBands(capture: SyntheticCapture) {
  const { shapeRateHz } = DSP_CONFIG.dsp2;
  const timebase = buildTimebase(capture.samples, capture.stats);
  const { primary } = fingerSignals(timebase);
  const [lowHz, highHz] = DSP_CONFIG.dsp6.morphologyBandHz as [number, number];
  const sos = butterBandpass(DSP_CONFIG.dsp6.morphologyOrder, lowHz, highHz, shapeRateHz);
  return resampleCubic(timebase.tS, primary, shapeRateHz)
    .filter((segment) => segment.values.length >= DSP_CONFIG.dsp7.minSegmentS * shapeRateHz)
    .map((segment) => ({ firstIndex: segment.firstIndex, values: filterZeroPhase(sos, segment.values) }));
}

// DSP-14 on one segment with Track D's training call (train/diabetes_features.py).
function segmentShape(analysis: ReadingAnalysis, capture: SyntheticCapture, segment: number) {
  const band = morphologyBands(capture)[segment]!;
  const aligned = analysis.segments[segment]!.filter(
    (beat) => beat.beatClass !== 'not-a-beat' && beat.onsetS !== null,
  );
  const onsets = aligned.map((beat) => beat.onsetS! * DSP_CONFIG.dsp2.shapeRateHz - band.firstIndex);
  const normal = aligned.map((beat) => beat.beatClass === 'normal');
  return ensembleBeat(band.values, onsets, normal, analysis.context.captureFps);
}

// The pairs ensembleBeat could average in one segment: consecutive onset beats that are both normal.
function normalPairs(beats: MeasuredBeat[]): number {
  const onsetBeats = beats.filter((beat) => beat.beatClass !== 'not-a-beat' && beat.onsetS !== null);
  return onsetBeats
    .slice(1)
    .filter((beat, i) => beat.beatClass === 'normal' && onsetBeats[i]!.beatClass === 'normal').length;
}

// Every diabetes-net input is either null or the model's shapes with only finite numbers and nulls, and
// it is null exactly when the analysis has no pulse shape, standard or lower quality (ADR 0104).
const anyShape = (analysis: ReadingAnalysis) => analysis.pulseShape ?? analysis.lowQuality.pulseShape;
function expectSafeInputs(analysis: ReadingAnalysis) {
  for (const rhythm of RHYTHMS) {
    const input = diabetesModelInput(analysis, rhythm);
    expect(input === null).toBe(anyShape(analysis) === null);
    if (!input) continue;
    expect(input.beat).toHaveLength(DSP_CONFIG.dsp14.beatSamples);
    expect(input.shapeFeatures).toHaveLength(SHAPE_FEATURE_NAMES.length);
    expect(input.hrSummary).toHaveLength(4);
    expect(Array.from(input.beat).every(Number.isFinite)).toBe(true);
    for (const value of [...input.shapeFeatures, ...input.hrSummary])
      expect(value === null || Number.isFinite(value)).toBe(true);
  }
}

const pulseShapeAvailable = (analysis: ReadingAnalysis) =>
  buildReadingResult(analysis, NO_MODELS, seedEvidence, PROFILE, []).experimental.pulseShape.available;

describe('red team ML-6: normal-pair counts around the DSP-14 minimum of 20', () => {
  // At 64 bpm from 0.5 s, a 21 s reading has 21 normal beats and 20 normal pairs.
  it.each([
    [2.5, 1],
    [19, 18],
    [20, 19],
    [21, 20],
    [22, 21],
  ])('a %s s sinus reading has %i normal pairs; the pulse shape needs 20', (seconds, pairs) => {
    const analysis = analyzeReading(sinusCapture(60, seconds), CONTEXT);
    expect(analysis.segments).toHaveLength(1);
    expect(normalPairs(analysis.segments[0]!)).toBe(pairs);
    expect(analysis.pulseShape === null).toBe(pairs < DSP_CONFIG.dsp14.minNormalBeats);
    expectSafeInputs(analysis);
  });

  it('at exactly 20 pairs every pair is used: no ensemble window runs off either end', () => {
    expect(analyzeReading(sinusCapture(60, 21), CONTEXT).pulseShape!.beatsUsed).toBe(20);
  });

  it('with motion over the whole reading every beat is an artifact: 0 pairs, no pulse shape', () => {
    const capture = sinusCapture(60, 90);
    const startNs = capture.samples[0]!.tNs;
    const analysis = analyzeReading(capture, {
      ...CONTEXT,
      motionSpans: [{ startNs, endNs: capture.samples[capture.samples.length - 1]!.tNs }],
    });
    const classes = new Set(analysis.segments.flat().map((beat) => beat.beatClass));
    expect([...classes]).toEqual(['artifact']);
    expect(analysis.pulseShape).toBeNull();
    expectSafeInputs(analysis);
  });

  it('bigeminy (every other beat premature at 0.6 coupling, 0.6 amplitude) never throws', () => {
    const premature = Array.from({ length: 60 }, (_, k) => 2 * k + 1);
    const footsS = withPrematureBeats(0.9, 89, premature, 0.6).map((beat) => beat.peakS);
    const analysis = analyzeReading(captureAt(regularOffsets(60, 90), beatTrain(footsS)), CONTEXT);
    const pairs = analysis.segments.reduce((total, beats) => total + normalPairs(beats), 0);
    expect(analysis.pulseShape === null).toBe(pairs < DSP_CONFIG.dsp14.minNormalBeats);
    expectSafeInputs(analysis);
  });

  it('a flat red channel has no segment with beats and no pulse shape', () => {
    const analysis = analyzeReading(captureAt(regularOffsets(60, 90), flatRed(0.6)), CONTEXT);
    expect(analysis.pulseShape).toBeNull();
    expect(diabetesModelInput(analysis, 'sinus')).toBeNull();
  });
});

describe('red team ML-6: ensembleBeat edges as analyzeReading calls it', () => {
  const { shapeRateHz } = DSP_CONFIG.dsp2;
  const periodSamples = Math.round((60 / BPM) * shapeRateHz);
  const band = Float64Array.from({ length: 30 * periodSamples }, (_, k) =>
    Math.sin((2 * Math.PI * k) / periodSamples),
  );
  const onsetsFrom = (first: number, count: number) =>
    Array.from({ length: count }, (_, i) => first + i * periodSamples);

  it.each([0, 1, 19])('%i onsets of normal beats give no pulse shape and do not throw', (count) => {
    expect(
      ensembleBeat(band, onsetsFrom(periodSamples, count), new Array<boolean>(count).fill(true), 60),
    ).toBeNull();
  });

  it('onsets at sample 0 and on the last sample: the windows that run off the band are skipped', () => {
    // 30 onsets from 0 to the last full period: the first window starts before 0 (lead-in) and the last
    // pair ends past the band, so 28 of 29 pairs are left and the shape still forms.
    const onsets = onsetsFrom(0, 30);
    onsets[29] = band.length - 1;
    const shape = ensembleBeat(band, onsets, new Array<boolean>(30).fill(true), 60);
    expect(shape).not.toBeNull();
    expect(shape!.beatsUsed).toBeLessThan(29);
    expect(Array.from(shape!.beat).every(Number.isFinite)).toBe(true);
  });

  it('a missing onset between two normal beats makes a double-period pair that maxPeriodRatio drops', () => {
    const onsets = onsetsFrom(periodSamples, 25);
    onsets.splice(12, 1);
    const shape = ensembleBeat(band, onsets, new Array<boolean>(onsets.length).fill(true), 60)!;
    expect(shape.beatsUsed).toBe(onsets.length - 2);
  });
});

describe('red team ML-6: which segment gives the pulse shape', () => {
  // Frames dropped around centreS for 0.5 s split the reading in two DSP-2 segments (DSP-2 splits at a
  // gap over its spline limit). The tie search moves the gap by half-frames until both 256 Hz segments
  // have the same length.
  const SECONDS = 90;
  const gapAround = (centreS: number) => (tS: number) => tS > centreS - 0.25 && tS < centreS + 0.25;

  it('on a tie in length the first segment is used', () => {
    // Segment lengths depend on the frame times only, so the search resamples a flat signal.
    const segmentLengths = (centreS: number) => {
      const times = Float64Array.from(regularOffsets(60, SECONDS).filter((tS) => !gapAround(centreS)(tS)));
      return resampleCubic(times, new Float64Array(times.length), DSP_CONFIG.dsp2.shapeRateHz).map(
        (segment) => segment.values.length,
      );
    };
    let centreS: number | null = null;
    for (let step = 0; step < 240 && centreS === null; step++) {
      const lengths = segmentLengths(44 + step / 120);
      if (lengths.length === 2 && lengths[0] === lengths[1]) centreS = 44 + step / 120;
    }
    expect(centreS).not.toBeNull();
    const tie = sinusCapture(60, SECONDS, BPM, gapAround(centreS!));
    const analysis = analyzeReading(tie, CONTEXT);
    expect(analysis.segments).toHaveLength(2);
    expect(analysis.pulseShape).toEqual(segmentShape(analysis, tie, 0));
    expect(analysis.pulseShape!.beat).not.toEqual(segmentShape(analysis, tie, 1)!.beat);
    expectSafeInputs(analysis);
  });

  // FAILS on 38eab7c. A 60 s stretch with no usable beats (flat red, or every beat an artifact under
  // motion), then a 0.5 s frame gap at 60 s, then 29 s of clean 64 bpm pulse with 29 normal pairs. The
  // longest segment by samples is the first, which has no normal pair, so pulseShape is null and
  // diabetes-net gets no input, while the second segment alone meets DSP-14 (≥ 20 normal beats, 60 fps).
  // Expected: the shape of the segment that can give one (here the second).
  it.each<[string, boolean]>([
    ['flat red for 60 s', false],
    ['motion for 60 s', true],
  ])('%s, a gap, then 29 s of clean pulse: the clean segment gives the pulse shape', (_, motion) => {
    const pulse = beatTrain(footsOf(SECONDS));
    const flat = flatRed(0.6);
    const channels: Channels = motion ? pulse : (tS) => (tS < 60 ? flat(tS) : pulse(tS));
    const capture = captureAt(
      regularOffsets(60, SECONDS).filter((tS) => !gapAround(60.25)(tS)),
      channels,
    );
    const startNs = capture.samples[0]!.tNs;
    const analysis = analyzeReading(capture, {
      ...CONTEXT,
      motionSpans: motion ? [{ startNs, endNs: startNs + 60e9 }] : [],
    });
    expect(analysis.segments).toHaveLength(2);
    expect(normalPairs(analysis.segments[0]!)).toBe(0);
    expect(normalPairs(analysis.segments[1]!)).toBeGreaterThanOrEqual(DSP_CONFIG.dsp14.minNormalBeats);
    const clean = segmentShape(analysis, capture, 1);
    expect(clean).not.toBeNull();
    expect(analysis.pulseShape).toEqual(clean);
  });
});

describe('red team ML-6: the result JSON agrees with the analysis on the pulse shape', () => {
  // FAILS on 38eab7c. experimental.pulseShape.available counts ≥ 20 normal beats over all segments
  // (rules.pulseShapeMinNormalBeats), but DSP-14 needs ≥ 20 averaged beats, each a pair of consecutive
  // normal beats, in the longest segment. A 20 s, 64 bpm reading has 20 normal beats and 19 pairs: the
  // result says a pulse shape is available and the analysis has none. Expected: available exactly when
  // analysis.pulseShape is not null.
  it.each([
    ['a 20 s sinus reading (20 normal beats, 19 pairs)', () => sinusCapture(60, 20)],
    [
      'a 90 s reading split at 30 s (holds: the 59.5 s segment gives the shape)',
      () => sinusCapture(60, 90, BPM, (tS) => tS > 30 && tS < 30.5),
    ],
    [
      'flat red for 60 s, a gap, then 29 s of pulse',
      () => {
        const pulse = beatTrain(footsOf(90));
        const flat = flatRed(0.6);
        return captureAt(
          regularOffsets(60, 90).filter((tS) => tS < 60 || tS > 60.5),
          (tS) => (tS < 60 ? flat(tS) : pulse(tS)),
        );
      },
    ],
  ])('%s', (_, build) => {
    const analysis = analyzeReading(build(), CONTEXT);
    expect(pulseShapeAvailable(analysis)).toBe(anyShape(analysis) !== null);
  });
});

describe('red team ML-6: captureFps as the context gives it', () => {
  const capture = sinusCapture(60, 90);

  it.each([59.999, NaN, -Infinity, 0, -60])(
    'captureFps %s: no standard pulse shape, no throw; the lower-quality beat is tagged lowFps',
    (captureFps) => {
      const analysis = analyzeReading(capture, { ...CONTEXT, captureFps });
      expect(analysis.pulseShape).toBeNull();
      expectSafeInputs(analysis);
      expect(analysis.heartRateBpm).not.toBeNull();
      const diabetes = { probability: 0.5, tauDm: 0.5 };
      const built = buildReadingResult(analysis, { rhythm: null, diabetes }, seedEvidence, PROFILE, []);
      expect(built.metrics.diabetes!.qualityReasons).toContain('lowFps');
      expect(built.metrics.rmssd?.qualityReasons ?? ['lowFps']).toContain('lowFps');
    },
  );

  it('captureFps 60 gives the pulse shape', () => {
    const analysis = analyzeReading(capture, CONTEXT);
    expect(analysis.pulseShape).not.toBeNull();
    expectSafeInputs(analysis);
  });

  // FAILS on 38eab7c. analyzeReading does not check captureFps, and the DSP-14 and DSP-12 gates are
  // written `!(fps >= min)`, which lets +Infinity through: the 60 fps frames above get a pulse shape and
  // RMSSD as if the format ran at any rate. A capture format has a finite rate (createLiveSession refuses
  // a bad one with a RangeError). Expected: a RangeError from analyzeReading, or no pulse shape.
  it('captureFps Infinity: refused or no pulse shape', () => {
    const outcome = outcomeOf(
      () => analyzeReading(capture, { ...CONTEXT, captureFps: Infinity }).pulseShape?.beat ?? null,
    );
    expect(['RangeError', 'null']).toContain(outcome);
  });
});

describe('red team ML-6: slow, fast, jittered, and damaged captures', () => {
  // 35 bpm: a 1.71 s period, so the lead-in of the first beat and the last window are long. 220 bpm: the
  // 0.40 s dicrotic wave of beatTrain falls in the next beat, so notch features are null, not NaN.
  it.each([
    [35, 60],
    [35, 240],
    [220, 60],
    [220, 240],
  ])('%i bpm at %i fps: a pulse shape with finite inputs', (bpm, fps) => {
    const analysis = analyzeReading(sinusCapture(fps, 90, bpm), { ...CONTEXT, captureFps: fps });
    expect(analysis.pulseShape).not.toBeNull();
    expect(analysis.pulseShape!.beatsUsed).toBeGreaterThanOrEqual(DSP_CONFIG.dsp14.minNormalBeats);
    expect(diabetesModelInput(analysis, 'sinus')!.hrSummary[0]).toBeCloseTo(bpm, 0);
    expectSafeInputs(analysis);
  });

  it.each([30, 60, 120, 240])('%i fps with ±0.3-frame timestamp jitter never throws', (fps) => {
    const capture = captureAt(jitteredOffsets(fps, 90, 0.3 / fps), beatTrain(beatTimes([0.9], 90)));
    const analysis = analyzeReading(capture, { ...CONTEXT, captureFps: fps });
    expect(analysis.pulseShape === null).toBe(fps < DSP_CONFIG.dsp14.minFps);
    expectSafeInputs(analysis);
  });

  it.each<[string, Partial<ReturnType<Channels>>]>([
    ['NaN red', { r: NaN }],
    ['+Infinity red', { r: Infinity }],
    ['red above 1', { r: 1.5 }],
  ])('%s on every 97th frame: dropped, and the pulse shape stays finite', (_, patch) => {
    const channels = patchFrames(beatTrain(footsOf(90)), 60, (k) => k % 97 === 50, patch);
    const analysis = analyzeReading(captureAt(regularOffsets(60, 90), channels), CONTEXT);
    expect(analysis.pulseShape).not.toBeNull();
    expectSafeInputs(analysis);
  });

  it('1 s flat runs every 10 s (a held exposure) never make a non-finite input', () => {
    const pulse = beatTrain(footsOf(90));
    const channels: Channels = (tS) => (tS % 10 < 1 ? pulse(Math.floor(tS / 10) * 10) : pulse(tS));
    const analysis = analyzeReading(captureAt(regularOffsets(60, 90), channels), CONTEXT);
    expectSafeInputs(analysis);
  });

  it('1 s of clipping every 10 s: artifacts are left out and the inputs stay finite', () => {
    const capture = sinusCapture(60, 90);
    capture.stats.forEach((stat, i) => {
      if (i % 600 < 60) stat.clipFrac = 0.9;
    });
    const analysis = analyzeReading(capture, CONTEXT);
    expect(analysis.segments.flat().some((beat) => beat.beatClass === 'artifact')).toBe(true);
    expect(analysis.pulseShape).not.toBeNull();
    expectSafeInputs(analysis);
  });
});

describe('red team ML-6: readingRhythm agrees with buildReadingResult', () => {
  const sinus = analyzeReading(sinusCapture(60, 90), CONTEXT);
  // 20 s: fewer than 32 intervals, so no rhythm window.
  const noWindows = analyzeReading(sinusCapture(60, 20), CONTEXT);
  const shortClean = { ...sinus, cleanSeconds: DSP_CONFIG.rules.rhythmMinCleanS - 0.001 };
  const labelled = { ...sinus, context: { ...sinus.context, validationRhythmLabel: 'sinus' as const } };
  const { uncertainBelowTopProb } = DSP_CONFIG.rules;

  // A probability row: softmax of seeded normals, or every 4th one with its top exactly at the abstain
  // line (0.6), where a different rounding in the two paths would split them.
  function randomRow(normal: () => number, k: number): [number, number, number] {
    if (k % 4 === 0) {
      const top = k % 3;
      const row: [number, number, number] = [0, 0, 0];
      row.forEach((_, c) => (row[c] = c === top ? uncertainBelowTopProb : (1 - uncertainBelowTopProb) / 2));
      return row;
    }
    const scale = 3 * Math.abs(normal());
    const exps = [normal(), normal(), normal()].map((z) => Math.exp(scale * z));
    const total = exps[0]! + exps[1]! + exps[2]!;
    return [exps[0]! / total, exps[1]! / total, exps[2]! / total];
  }

  it.each<[string, ReadingAnalysis]>([
    ['90 s sinus', sinus],
    ['no rhythm windows', noWindows],
    ['clean seconds just under the rhythm floor', shortClean],
    ['a validation label with a model output', labelled],
  ])('%s: 300 seeded outputs × both profiles agree', (_, analysis) => {
    const normal = seededNormal(146);
    for (let k = 0; k < 300; k++) {
      const outputs: RhythmOutputs = {
        windowProbs: rhythmModelRows(analysis).map((__, w) => randomRow(normal, k + w)),
        tauAf: Math.abs(normal()) / 3,
      };
      for (const profile of [PROFILE, { ...PROFILE, pacemaker: true }]) {
        const rhythm = readingRhythm(analysis, outputs, profile);
        const built = buildReadingResult(
          analysis,
          { rhythm: outputs, diabetes: null },
          seedEvidence,
          profile,
          [],
        );
        const card = built.metrics.rhythm;
        expect(rhythm === null).toBe(card === null);
        if (rhythm !== null && rhythm !== 'uncertain') expect(card!.class).toBe(rhythm);
        if (rhythm === null && built.metrics.hr) expect(built.headlineKey).toBe('result.hrOnly');
        if (rhythm === 'uncertain') expect(built.headlineKey).toBe('result.uncertain');
        if (rhythm === 'sinus' && card!.flag === null) expect(built.headlineKey).toBe('result.regular');
        expect(built.metrics.rmssd !== null).toBe(rhythm === 'sinus');
      }
    }
  });

  it('with no model output both take the validation label, pacemaker or not (ADR 0041)', () => {
    for (const profile of [PROFILE, { ...PROFILE, pacemaker: true }]) {
      expect(readingRhythm(labelled, null, profile)).toBe('sinus');
      expect(buildReadingResult(labelled, NO_MODELS, seedEvidence, profile, []).metrics.rmssd).not.toBeNull();
      expect(readingRhythm(sinus, null, profile)).toBeNull();
      // No judgement at all: a lower-quality RMSSD (ADR 0104), none with a pacemaker.
      const rmssd = buildReadingResult(sinus, NO_MODELS, seedEvidence, profile, []).metrics.rmssd;
      if (profile.pacemaker) expect(rmssd).toBeNull();
      else expect(rmssd).toMatchObject({ quality: 'low', qualityReasons: ['rhythmUnjudged'] });
    }
  });
});

describe('red team ML-6: the pulse-shape step stays cheap at 240 fps', () => {
  // captureFps is read in analyzeReading only by the DSP-14 gate, so 59 fps skips the pulse-shape step
  // on the same frames. CPU time, not wall time: a shared CI runner's waits for other jobs inflated one
  // side to a 1.695 ratio (run 37093524735). After a warm-up pair, each run times "with" and "without"
  // back to back (order alternating) and the ratio of that pair counts; the median of five pairs is
  // reported, so one slow phase or garbage collection can't decide it. Each call takes 0.1–1 s of CPU,
  // far above Windows' ~15.6 ms CPU-time step. sinePulse, not beatTrain: beatTrain sums every beat at
  // every frame, minutes of setup at this size.
  const cpuMs = (run: () => void) => {
    const start = process.cpuUsage();
    run();
    const spent = process.cpuUsage(start);
    return (spent.user + spent.system) / 1000;
  };
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
  const analyzeMs = (seconds: number) => {
    const capture = captureAt(regularOffsets(240, seconds), sinePulse(72));
    const analyze = (captureFps: number) => () => analyzeReading(capture, { ...CONTEXT, captureFps });
    analyze(240)();
    analyze(59)();
    const pairs = Array.from({ length: 5 }, (_, run) => {
      if (run % 2 === 0) {
        const withMs = cpuMs(analyze(240));
        return { with: withMs, without: cpuMs(analyze(59)) };
      }
      const withoutMs = cpuMs(analyze(59));
      return { with: cpuMs(analyze(240)), without: withoutMs };
    });
    return {
      with: median(pairs.map((pair) => pair.with)),
      without: median(pairs.map((pair) => pair.without)),
      ratio: median(pairs.map((pair) => pair.with / pair.without)),
    };
  };

  // ensembleBeat alone on a 72 bpm 256 Hz band, as the longest segment of a 240 fps reading gives it.
  const ensembleMs = (seconds: number) => {
    const { shapeRateHz } = DSP_CONFIG.dsp2;
    const periodSamples = (60 / 72) * shapeRateHz;
    const band = Float64Array.from({ length: seconds * shapeRateHz }, (_, k) =>
      Math.sin((2 * Math.PI * k) / periodSamples),
    );
    const onsets = Array.from(
      { length: Math.floor(seconds / (60 / 72)) - 1 },
      (_, i) => (i + 0.5) * periodSamples,
    );
    const normal = onsets.map(() => true);
    const timesMs = [0, 1, 2].map(() => {
      const startedMs = performance.now();
      ensembleBeat(band, onsets, normal, 240);
      return performance.now() - startedMs;
    });
    return Math.min(...timesMs);
  };

  it('360 s at 240 fps: pulseShape adds under 50%, and its cost grows about linearly', () => {
    const short = analyzeMs(90);
    const long = analyzeMs(360);
    const [ensembleShort, ensembleLong] = [ensembleMs(90), ensembleMs(360)];
    console.info(
      `analyzeReading at 240 fps: 90 s ${short.with.toFixed(0)} ms with pulseShape, ${short.without.toFixed(0)}` +
        ` ms without; 360 s ${long.with.toFixed(0)} ms with, ${long.without.toFixed(0)} ms without.` +
        ` ensembleBeat alone: 90 s ${ensembleShort.toFixed(1)} ms, 360 s ${ensembleLong.toFixed(1)} ms`,
    );
    expect(long.ratio).toBeLessThan(1.5);
    expect(long.with / short.with).toBeLessThan(10);
    // 4× the beats: linear is 4×; 8× would be worse than linear.
    expect(ensembleLong / ensembleShort).toBeLessThan(8);
  }, 600_000);
});
