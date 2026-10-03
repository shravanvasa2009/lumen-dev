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
  hrSummary,
  readingRhythm,
  resampleCubic,
  SHAPE_FEATURE_NAMES,
  shapeFeatures,
  type MeasuredBeat,
  type ModelOutputs,
  type Profile,
  type ReadingAnalysis,
  type ReadingContext,
  type ReadingRhythm,
  type RhythmOutputs,
} from '../src';
import seedEvidence from '../../../docs/validation/evidence.json';
import { beatTrain } from './redteam/attacks';
import {
  captureAt,
  regularBeats,
  regularOffsets,
  withPrematureBeats,
  type SyntheticCapture,
} from './synthetic';

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
const SECONDS = 90;

function sinusCapture(fps = 60, seconds = SECONDS, drop?: (tS: number) => boolean): SyntheticCapture {
  const footsS = regularBeats(0.5, seconds - 1, 64).map((beat) => beat.peakS);
  const offsets = regularOffsets(fps, seconds).filter((tS) => !drop?.(tS));
  return captureAt(offsets, beatTrain(footsS));
}

// Every 4th beat premature at 0.6 × 0.9 s: atypical beats that are onsets but not "normal".
function ectopicCapture(): SyntheticCapture {
  const premature = Array.from({ length: 24 }, (_, k) => 3 + 4 * k);
  const footsS = withPrematureBeats(0.9, SECONDS - 1, premature, 0.6).map((beat) => beat.peakS);
  return captureAt(regularOffsets(60, SECONDS), beatTrain(footsS));
}

// The DSP-6 morphology band of each DSP-2 segment at 256 Hz, rebuilt here from exported core steps for a
// capture with no broken frames; segments shorter than dsp7.minSegmentS are dropped, as analyzeReading does.
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

// Track D's training call (train/diabetes_features.py): onsets of every beat that is not "not-a-beat"
// and has an onset, in 256 Hz samples of the segment; normal = class "normal"; the capture format's fps.
// isNormal is replaceable so a test can show the flags matter.
function expectedShape(
  analysis: ReadingAnalysis,
  capture: SyntheticCapture,
  segment: number,
  isNormal = (beat: MeasuredBeat) => beat.beatClass === 'normal',
) {
  const band = morphologyBands(capture)[segment]!;
  const aligned = analysis.segments[segment]!.filter(
    (beat) => beat.beatClass !== 'not-a-beat' && beat.onsetS !== null,
  );
  const onsets = aligned.map((beat) => beat.onsetS! * DSP_CONFIG.dsp2.shapeRateHz - band.firstIndex);
  const normal = aligned.map(isNormal);
  return ensembleBeat(band.values, onsets, normal, analysis.context.captureFps);
}

const sinusRows = (analysis: ReadingAnalysis, row: [number, number, number]): RhythmOutputs => ({
  windowProbs: analysis.rhythmWindows.map(() => row),
  tauAf: 0.5,
});

describe('ML-6 diabetes-net input from an analysed reading', () => {
  const cases: [string, SyntheticCapture][] = [
    ['sinus 64 bpm', sinusCapture()],
    ['every 4th beat premature', ectopicCapture()],
  ];

  it.each(cases)('%s: the pulse shape is DSP-14 called with the training contract', (_, capture) => {
    const analysis = analyzeReading(capture, CONTEXT);
    expect(analysis.segments).toHaveLength(1);
    const expected = expectedShape(analysis, capture, 0);
    expect(expected).not.toBeNull();
    expect(analysis.pulseShape).toEqual(expected);
  });

  it('on the ectopic reading, the normal flags change the beat (atypical beats are left out)', () => {
    const [, capture] = cases[1]!;
    const analysis = analyzeReading(capture, CONTEXT);
    expect(analysis.segments[0]!.map((beat) => beat.beatClass)).toContain('atypical');
    const allNormal = expectedShape(analysis, capture, 0, () => true)!;
    expect(allNormal.beatsUsed).toBeGreaterThan(analysis.pulseShape!.beatsUsed);
    expect(allNormal.beat).not.toEqual(analysis.pulseShape!.beat);
  });

  it.each(cases)('%s: beat, shapeFeatures, and hrSummary equal the direct calls', (_, capture) => {
    const analysis = analyzeReading(capture, CONTEXT);
    const input = diabetesModelInput(analysis, 'sinus')!;
    const shape = expectedShape(analysis, capture, 0)!;
    expect(input.beat).toEqual(shape.beat);
    expect(input.beat).toHaveLength(DSP_CONFIG.dsp14.beatSamples);
    expect(input.shapeFeatures).toEqual(shapeFeatures(shape));
    expect(input.shapeFeatures).toHaveLength(SHAPE_FEATURE_NAMES.length);
    expect(input.hrSummary).toEqual(hrSummary(analysis.segments, 'sinus', 60, analysis.cleanSeconds));
  });

  it('a sinus 90 s scan has HR, RMSSD, and pNN50, but no SDNN (DSP-12 needs 300 s)', () => {
    const summary = diabetesModelInput(analyzeReading(sinusCapture(), CONTEXT), 'sinus')!.hrSummary;
    expect(summary[0]).toBeCloseTo(64, 0);
    expect(summary[1]).not.toBeNull();
    expect(summary[2]).toBeNull();
    expect(summary[3]).not.toBeNull();
  });

  it.each<[ReadingRhythm | null]>([['af'], ['other'], ['uncertain'], [null]])(
    'rhythm %s: HR stays, HRV is null, the pulse shape is unchanged',
    (rhythm) => {
      const analysis = analyzeReading(sinusCapture(), CONTEXT);
      const input = diabetesModelInput(analysis, rhythm)!;
      const sinus = diabetesModelInput(analysis, 'sinus')!;
      expect(input.hrSummary[0]).toBe(sinus.hrSummary[0]);
      expect(input.hrSummary.slice(1)).toEqual([null, null, null]);
      expect(input.beat).toEqual(sinus.beat);
      expect(input.shapeFeatures).toEqual(sinus.shapeFeatures);
    },
  );

  it('is null at a 30 fps capture format (DSP-14 needs 60)', () => {
    const analysis = analyzeReading(sinusCapture(30), { ...CONTEXT, captureFps: 30 });
    expect(analysis.heartRateBpm).not.toBeNull();
    expect(analysis.pulseShape).toBeNull();
    expect(diabetesModelInput(analysis, 'sinus')).toBeNull();
  });

  it('gates on the configured 60 fps format, not the measured 59.94 fps frame rate', () => {
    const analysis = analyzeReading(sinusCapture(59.94), CONTEXT);
    expect(analysis.pulseShape).not.toBeNull();
  });

  it('is null with fewer than 20 normal beat pairs', () => {
    const analysis = analyzeReading(sinusCapture(60, 18), CONTEXT);
    const normal = analysis.segments.flat().filter((beat) => beat.beatClass === 'normal');
    expect(normal.length).toBeLessThan(DSP_CONFIG.dsp14.minNormalBeats + 1);
    expect(analysis.pulseShape).toBeNull();
    expect(diabetesModelInput(analysis, 'sinus')).toBeNull();
  });

  it('with a gap, averages the longest DSP-2 segment only (training has one gap-free segment)', () => {
    const capture = sinusCapture(60, SECONDS, (tS) => tS > 30 && tS < 30.3);
    const analysis = analyzeReading(capture, CONTEXT);
    expect(analysis.segments).toHaveLength(2);
    const longer = expectedShape(analysis, capture, 1);
    expect(longer).not.toBeNull();
    expect(analysis.pulseShape).toEqual(longer);
    expect(analysis.pulseShape!.beatsUsed).not.toBe(expectedShape(analysis, capture, 0)!.beatsUsed);
    // HR and HRV still summarise the whole reading, as the displayed values do.
    expect(diabetesModelInput(analysis, 'sinus')!.hrSummary).toEqual(
      hrSummary(analysis.segments, 'sinus', 60, analysis.cleanSeconds),
    );
  });
});

describe('readingRhythm: the rhythm decision that opens DSP-12', () => {
  const analysis = analyzeReading(sinusCapture(), CONTEXT);
  const models = (rhythm: RhythmOutputs | null): ModelOutputs => ({ rhythm, diabetes: null });
  const rmssdShown = (rhythm: RhythmOutputs | null, profile = PROFILE, reading = analysis) =>
    buildReadingResult(reading, models(rhythm), seedEvidence, profile, []).metrics.rmssd !== null;

  it.each<[string, [number, number, number], ReadingRhythm]>([
    ['confident sinus', [0.9, 0.05, 0.05], 'sinus'],
    ['confident AF', [0.05, 0.9, 0.05], 'af'],
    ['confident other', [0.05, 0.05, 0.9], 'other'],
    ['sinus below the abstain line', [0.5, 0.3, 0.2], 'uncertain'],
  ])('%s gives %s, and the RMSSD card shows only for sinus', (_, row, expected) => {
    const outputs = sinusRows(analysis, row);
    expect(readingRhythm(analysis, outputs, PROFILE)).toBe(expected);
    expect(rmssdShown(outputs)).toBe(expected === 'sinus');
  });

  it('is null with no rhythm output, a pacemaker, or too little clean signal', () => {
    const sinus = sinusRows(analysis, [0.9, 0.05, 0.05]);
    expect(readingRhythm(analysis, null, PROFILE)).toBeNull();
    expect(readingRhythm(analysis, sinus, { ...PROFILE, pacemaker: true })).toBeNull();
    expect(rmssdShown(sinus, { ...PROFILE, pacemaker: true })).toBe(false);
    const short = { ...analysis, cleanSeconds: DSP_CONFIG.rules.rhythmMinCleanS - 1 };
    expect(readingRhythm(short, sinus, PROFILE)).toBeNull();
  });

  it('takes the validation label only when no rhythm model ran (replay, ADR 0041)', () => {
    const labelled = {
      ...analysis,
      context: { ...analysis.context, validationRhythmLabel: 'sinus' as const },
    };
    expect(readingRhythm(labelled, null, PROFILE)).toBe('sinus');
    expect(rmssdShown(null, PROFILE, labelled)).toBe(true);
    expect(readingRhythm(labelled, sinusRows(analysis, [0.05, 0.9, 0.05]), PROFILE)).toBe('af');
  });

  it('refuses rhythm rows that are not probabilities, as buildReadingResult does', () => {
    expect(() => readingRhythm(analysis, sinusRows(analysis, [0.9, 0.9, 0.9]), PROFILE)).toThrow(RangeError);
  });
});
