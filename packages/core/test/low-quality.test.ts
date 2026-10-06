import {
  analyzeReading,
  breathingEstimates,
  breathingRate,
  buildReadingResult,
  DSP_CONFIG,
  emergencyHeartRate,
  ensembleBeat,
  judgesRhythm,
  lowQualityEnsembleBeat,
  lowQualityHeartRate,
  lowQualityRmssd,
  readingOutcome,
  readingRhythm,
  readingWideWindow,
  rhythmModelRows,
  rhythmWindows,
  type BeatClass,
  type ClassifiedBeat,
  type MeasuredBeat,
  type ReadingContext,
} from '../src';
import seedEvidence from '../../../docs/validation/evidence.json';
import { captureAt, regularOffsets } from './synthetic';

// Mirrored by ml/lumen_dsp/tests/test_dsp_low_quality.py with the same inputs and expected values (§10.2).

function beatsAt(peaksS: number[], classes: BeatClass[] = []): ClassifiedBeat[] {
  return peaksS.map((peakS, i) => ({
    peakS,
    onsetS: peakS - 0.1,
    beatClass: classes[i] ?? 'normal',
    longPause: false,
  }));
}

// Peaks whose intervals alternate 0.8 s and 0.9 s, from 1 s.
function alternating(count: number): number[] {
  const peaksS = [1];
  for (let i = 1; i < count; i++) peaksS.push(peaksS[i - 1]! + (i % 2 === 1 ? 0.8 : 0.9));
  return peaksS;
}

describe('lowQualityHeartRate (DSP-11 below its floors, ADR 0104)', () => {
  it('is 60 / the median of two accepted intervals, with no clean-seconds floor', () => {
    expect(lowQualityHeartRate([beatsAt(alternating(3))])).toBeCloseTo(60 / 0.85, 12);
  });

  it('needs two accepted intervals: one, or one bridged by an artifact, is not enough', () => {
    expect(lowQualityHeartRate([beatsAt(alternating(2))])).toBeNull();
    expect(lowQualityHeartRate([beatsAt(alternating(3), ['normal', 'artifact', 'normal'])])).toBeNull();
    expect(lowQualityHeartRate([])).toBeNull();
  });

  it('leaves out a beat found twice and never pairs intervals across segments', () => {
    expect(lowQualityHeartRate([beatsAt([1, 1, 1.8])])).toBeNull();
    expect(lowQualityHeartRate([beatsAt([1, 1.8]), beatsAt([10, 10.9])])).toBeCloseTo(60 / 0.85, 12);
  });
});

describe('lowQualityRmssd (DSP-12 below its floors, ADR 0104)', () => {
  it('is RMSSD in ms from three NN intervals after the 20% filter', () => {
    const low = lowQualityRmssd([beatsAt(alternating(4))])!;
    expect(low.nnIntervals).toBe(3);
    expect(low.rmssdMs).toBeCloseTo(100, 9);
  });

  it('needs three NN intervals and one successive difference', () => {
    expect(lowQualityRmssd([beatsAt(alternating(3))])).toBeNull();
    // Three NN intervals, each in its own run: no successive difference.
    const split = beatsAt(alternating(7), [
      'normal',
      'normal',
      'atypical',
      'normal',
      'normal',
      'atypical',
      'normal',
    ]);
    expect(lowQualityRmssd([split])).toBeNull();
  });
});

describe('readingWideWindow (DSP-15 below its floors, ADR 0104)', () => {
  const intervals = (count: number) => Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 0.8 : 0.9));

  it('is one window over the longest usable run, when no 32-interval window fits', () => {
    const intervalsS = intervals(14);
    const spans = intervalsS.map((_, i) => i === 3);
    const window = readingWideWindow(intervalsS, spans, new Array(15).fill(false))!;
    expect(window.startInterval).toBe(4);
    expect(window.intervalsS).toEqual(intervalsS.slice(4));
    expect(window.normalizedRmssd).toBeCloseTo(0.1 / 0.85, 12);
    expect(window.turningPointRatio).toBe(1);
    expect(window.pnn50).toBe(1);
    expect(window.atypicalFraction).toBe(0);
  });

  it('takes the first of two equally long runs, and needs three intervals', () => {
    const spans = [false, false, false, true, false, false, false];
    expect(readingWideWindow(intervals(7), spans, new Array(8).fill(false))!.startInterval).toBe(0);
    expect(readingWideWindow(intervals(2), [false, false], [false, false, false])).toBeNull();
  });

  // Owner 2026-10-06 (ADR 0104 answer 5): a few seconds of AF can read regular, so a class needs 20 intervals.
  it('gives a class only from 20 intervals', () => {
    const window = (count: number) =>
      readingWideWindow(intervals(count), new Array(count).fill(false), new Array(count + 1).fill(false))!;
    expect(DSP_CONFIG.lowQuality.rhythmClassMinIntervals).toBe(20);
    expect(judgesRhythm(window(3))).toBe(false);
    expect(judgesRhythm(window(19))).toBe(false);
    expect(judgesRhythm(window(20))).toBe(true);
    expect(judgesRhythm(window(31))).toBe(true);
  });

  it('is null whenever a standard window fits', () => {
    const intervalsS = intervals(DSP_CONFIG.dsp15.windowIntervals);
    const spans = new Array(intervalsS.length).fill(false);
    const beats = new Array(intervalsS.length + 1).fill(false);
    expect(rhythmWindows(intervalsS, spans, beats)).toHaveLength(1);
    expect(readingWideWindow(intervalsS, spans, beats)).toBeNull();
  });

  it('refuses the inputs rhythmWindows refuses', () => {
    expect(() =>
      readingWideWindow([0.8, Number.NaN, 0.8], [false, false, false], [false, false, false, false]),
    ).toThrow(RangeError);
    expect(() => readingWideWindow([0.8], [false], [false])).toThrow(RangeError);
  });
});

describe('breathingEstimates and lowQualityEnsembleBeat keep the standard math', () => {
  // 70 s of normal beats at 0.85 s with intensity, amplitude, and interval modulated at 0.25 Hz.
  const measured: MeasuredBeat[] = [];
  for (let peakS = 1; peakS < 71;) {
    const breath = Math.sin(2 * Math.PI * 0.25 * peakS);
    measured.push({
      peakS,
      onsetS: peakS - 0.1,
      beatClass: 'normal',
      longPause: false,
      amplitude: 1 + 0.1 * breath,
      intensity: -0.6 + 0.01 * breath,
      dc: -0.6,
    });
    peakS += 0.85 + 0.03 * breath;
  }

  it('gives breathingRate’s numbers at any clean seconds', () => {
    expect(breathingEstimates([measured])).toEqual(breathingRate([measured], 60));
    expect(breathingRate([measured], 59)).toBeNull();
    expect(breathingEstimates([measured]).rateBrpm).toBeCloseTo(15, 0);
  });

  it('averages the same beat as ensembleBeat where both run, and also below 60 fps and 20 beats', () => {
    const rateHz = DSP_CONFIG.dsp2.shapeRateHz;
    const wave = Array.from({ length: 40 * rateHz }, (_, k) => Math.sin((2 * Math.PI * k) / (0.85 * rateHz)));
    const onsets = Array.from({ length: 45 }, (_, i) => Math.round((0.5 + 0.85 * i) * rateHz));
    const normal = onsets.map(() => true);
    expect(lowQualityEnsembleBeat(wave, onsets, normal)).toEqual(ensembleBeat(wave, onsets, normal, 60));
    expect(ensembleBeat(wave, onsets, normal, 30)).toBeNull();
    expect(lowQualityEnsembleBeat(wave, onsets.slice(0, 3), normal.slice(0, 3))!.beatsUsed).toBe(2);
    expect(lowQualityEnsembleBeat(wave, onsets.slice(0, 1), normal.slice(0, 1))).toBeNull();
    expect(() => lowQualityEnsembleBeat(wave, onsets, normal.slice(1))).toThrow(RangeError);
  });
});

const CONTEXT: ReadingContext = {
  captureFps: 30,
  tier: 'basic',
  mode: 'quick',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};
const PROFILE = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };

// −R pulses at `bpm` on a covered fingertip (R/(G+B) ≈ 4); `second` adds a dicrotic wave 0.45 of a beat on.
function fingertip(seconds: number, bpm = 72, second = 0, fps = 30) {
  const periodS = 60 / bpm;
  return captureAt(regularOffsets(fps, seconds), (tS) => {
    const phaseS = (tS - 0.5 + 10 * periodS) % periodS;
    const pulse =
      Math.exp(-0.5 * (phaseS / 0.06) ** 2) +
      second * Math.exp(-0.5 * ((phaseS - 0.45 * periodS) / 0.08) ** 2);
    return { r: 0.62 - 0.004 * pulse, g: 0.11, b: 0.04 };
  });
}

describe('analyzeReading and the results on the beats there are (ADR 0104)', () => {
  it('a 10 s capture: no standard heart rate, a lower-quality one, a reading-wide rhythm row', () => {
    const analysis = analyzeReading(fingertip(10), CONTEXT);
    expect(analysis.heartRateBpm).toBeNull();
    expect(analysis.lowQuality.heartRateBpm).toBeCloseTo(72, 0);
    expect(analysis.rhythmFeatures).toEqual([]);
    expect(analysis.lowQuality.rhythmWindow!.intervalsS.length).toBeGreaterThanOrEqual(3);
    expect(rhythmModelRows(analysis)).toEqual([analysis.lowQuality.rhythmFeatures]);
    expect(readingOutcome(analysis).kind).toBe('reading');

    const rows = rhythmModelRows(analysis).map((): [number, number, number] => [0.9, 0.05, 0.05]);
    const reading = buildReadingResult(
      analysis,
      { rhythm: { windowProbs: rows, tauAf: 0.5 }, diabetes: null },
      seedEvidence,
      PROFILE,
      [],
    );
    expect(reading.metrics.hr).toMatchObject({ quality: 'low', qualityReasons: ['shortClean'], flag: null });
    expect(reading.metrics.rhythm!.qualityReasons).toEqual(['shortClean', 'fewBeats', 'fewWindows']);
    expect(reading.quality.level).toBe('low');
    expect(reading.quality.reasons).toContainEqual({
      kind: 'shortClean',
      haveS: analysis.cleanSeconds,
      wantS: 60,
    });
  });

  // Owner 2026-10-06 (ADR 0104 answer 5): under 20 intervals the card reads "too short to judge", with no class
  // and no flag, whatever the model says. Nothing else reads the call: RMSSD is unjudged and the headline is the rate.
  it.each([
    ['sinus', [0.9, 0.05, 0.05]],
    ['AF', [0.05, 0.9, 0.05]],
  ] as const)('a 10 s capture scored %s is too short to judge the rhythm', (_, probs) => {
    const analysis = analyzeReading(fingertip(10), CONTEXT);
    expect(analysis.lowQuality.rhythmWindow!.intervalsS.length).toBeLessThan(20);
    const rhythm = { windowProbs: [[...probs]] as [number, number, number][], tauAf: 0.25 };
    const reading = buildReadingResult(analysis, { rhythm, diabetes: null }, seedEvidence, PROFILE, []);
    expect(reading.metrics.rhythm).toMatchObject({ class: null, pAF: null, flag: null, quality: 'low' });
    expect(reading.headlineKey).toBe('result.hrOnly');
    expect(readingRhythm(analysis, rhythm, PROFILE)).toBeNull();
    if (reading.metrics.rmssd) expect(reading.metrics.rmssd.qualityReasons).toContain('rhythmUnjudged');
  });

  it('a 20 s capture at 72 bpm has enough intervals for a lower-quality class', () => {
    const analysis = analyzeReading(fingertip(20), CONTEXT);
    expect(analysis.rhythmFeatures).toEqual([]);
    expect(judgesRhythm(analysis.lowQuality.rhythmWindow!)).toBe(true);
    const rhythm = { windowProbs: [[0.9, 0.05, 0.05]] as [number, number, number][], tauAf: 0.5 };
    const reading = buildReadingResult(analysis, { rhythm, diabetes: null }, seedEvidence, PROFILE, []);
    expect(reading.metrics.rhythm).toMatchObject({ class: 'sinus', quality: 'low' });
    expect(reading.headlineKey).toBe('result.regular');
  });

  it('two beats: no heart rate even at the lower floor, so the capture is inconclusive', () => {
    const analysis = analyzeReading(fingertip(2.2), CONTEXT);
    expect(analysis.heartRateBpm).toBeNull();
    expect(analysis.lowQuality.heartRateBpm).toBeNull();
    expect(analysis.lowQuality.rhythmWindow).toBeNull();
    expect(readingOutcome(analysis)).toMatchObject({
      kind: 'inconclusive',
      reasons: ['tooFewCleanSeconds', 'noHeartRate'],
    });
  });

  it('broken frames (NaN red) leave every lower-quality value finite or null', () => {
    const capture = fingertip(12);
    for (let k = 40; k < capture.samples.length; k += 37)
      capture.samples[k] = { ...capture.samples[k]!, r: Number.NaN };
    const analysis = analyzeReading(capture, CONTEXT);
    const { heartRateBpm, rhythmFeatures, breathing } = analysis.lowQuality;
    expect(heartRateBpm === null || Number.isFinite(heartRateBpm)).toBe(true);
    expect((rhythmFeatures ?? []).every(Number.isFinite)).toBe(true);
    expect(
      [breathing?.rateBrpm, breathing?.intervalBrpm].every((brpm) => brpm == null || Number.isFinite(brpm)),
    ).toBe(true);
    const reading = buildReadingResult(analysis, { rhythm: null, diabetes: null }, seedEvidence, PROFILE, []);
    expect(reading.quality.reasons.length).toBeGreaterThan(0);
  });

  it('a strong dicrotic wave at 50 bpm: whatever rate DSP-7 finds, the low path stays finite and tagged', () => {
    const analysis = analyzeReading(fingertip(12, 50, 0.95), CONTEXT);
    const bpm = analysis.heartRateBpm ?? analysis.lowQuality.heartRateBpm;
    expect(bpm).not.toBeNull();
    expect(bpm! > 40 && bpm! < 120).toBe(true);
    const reading = buildReadingResult(analysis, { rhythm: null, diabetes: null }, seedEvidence, PROFILE, []);
    expect(reading.metrics.hr!.quality).toBe('low');
    expect(Number.isFinite(reading.metrics.hr!.value)).toBe(true);
  });
});

// Owner 2026-10-06 (ADR 0104 answer 2): a lower-quality rate under 40 or over 150 bpm asks for a retake now. It is
// not the Emergency screen: SAFE-1 still reads only the standard analysis.
describe('retake prompt for an extreme lower-quality rate (SAFE-1 unchanged)', () => {
  const resultOf = (seconds: number, bpm: number, mode: ReadingContext['mode'] = 'quick') => {
    const analysis = analyzeReading(fingertip(seconds, bpm), { ...CONTEXT, mode });
    const reading = buildReadingResult(analysis, { rhythm: null, diabetes: null }, seedEvidence, PROFILE, []);
    return { analysis, reading };
  };

  it.each([
    [35, 'shortSlow'],
    [190, 'shortFast'],
  ] as const)('12 s at %i bpm: the rate tagged, the %s prompt, no urgent screen', (bpm, prompt) => {
    const { analysis, reading } = resultOf(12, bpm);
    expect(analysis.heartRateBpm).toBeNull();
    // This narrow synthetic pulse reads 190 bpm as about 183 at 30 fps; the red team's beatTrain checks accuracy.
    expect(reading.metrics.hr!.value < 40 || reading.metrics.hr!.value > 150).toBe(true);
    expect(reading.metrics.hr).toMatchObject({ quality: 'low', flag: null });
    expect(reading.retakePrompt).toBe(prompt);
    expect(emergencyHeartRate(analysis)).toBeNull();
    expect(readingOutcome(analysis)).toEqual({ kind: 'reading', urgent: null });
  });

  it('no prompt for a lower-quality rate from 40 to 150 bpm', () => {
    for (const bpm of [45, 72, 140]) expect(resultOf(12, bpm).reading.retakePrompt).toBeNull();
  });

  it('a standard 35 bpm keeps SAFE-1’s slow rule and gets no retake prompt', () => {
    const { analysis, reading } = resultOf(40, 35, 'full');
    expect(analysis.heartRateBpm).not.toBeNull();
    expect(reading.metrics.hr!.quality).toBe('standard');
    expect(reading.retakePrompt).toBeNull();
    expect(emergencyHeartRate(analysis)).toEqual({ fastSustained: false, slowBelow40: true });
    expect(readingOutcome(analysis).urgent).toEqual({ fastSustained: false, slowBelow40: true });
  });
});

describe('Quick Check tags only what misses a floor (owner 2026-10-06, ADR 0104 answer 4)', () => {
  it('a 30 s Quick at good quality: a standard heart rate, a rhythm tagged for its 60 clean seconds', () => {
    const analysis = analyzeReading(fingertip(30), CONTEXT);
    expect(analysis.heartRateBpm).not.toBeNull();
    const rhythm = {
      windowProbs: rhythmModelRows(analysis).map((): [number, number, number] => [0.9, 0.05, 0.05]),
      tauAf: 0.5,
    };
    const reading = buildReadingResult(analysis, { rhythm, diabetes: null }, seedEvidence, PROFILE, []);
    expect(reading.metrics.hr).toMatchObject({ quality: 'standard', qualityReasons: [] });
    expect(reading.metrics.rhythm).toMatchObject({ class: 'sinus', quality: 'low' });
    expect(reading.metrics.rhythm!.qualityReasons).toContain('shortClean');
    expect(JSON.stringify(reading)).not.toContain('quickMode');
  });
});
