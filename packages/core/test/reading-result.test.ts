import {
  analyzeReading,
  buildReadingResult,
  DSP_CONFIG,
  isProbabilityRow,
  logisticRhythmOutputs,
  type EvidenceFile,
  type FrameStat,
  type ModelOutputs,
  type PastReading,
  type Profile,
  type ReadingAnalysis,
  type ReadingContext,
  type Sample,
} from '../src';
import seedEvidence from '../../../docs/validation/evidence.json';
import ruleFixture from './fixtures/rhythm-logistic.json';

const CLOCK_START_NS = 5_000_000_000_000;
const HOUR_MS = 3_600_000;
const NOW_MS = Date.UTC(2026, 9, 4, 12);

// 95 s at 60 fps (over the 90 s diabetes floor), 64 bpm with mild RSA and breathing at 15/min: a clean sinus reading.
function cleanCapture(): { samples: Sample[]; stats: FrameStat[] } {
  const peaksS: number[] = [];
  for (let peakS = 0.6; peakS < 96; peakS += 0.9375 * (1 - 0.04 * Math.sin((2 * Math.PI * peakS) / 4)))
    peaksS.push(peakS);
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (let k = 0; k < 5700; k++) {
    const tS = k / 60;
    let pulse = 0;
    for (const peakS of peaksS)
      if (Math.abs(tS - peakS) < 0.5) pulse += Math.exp(-0.5 * ((tS - peakS) / 0.06) ** 2);
    const tNs = CLOCK_START_NS + Math.round(tS * 1e9);
    samples.push({
      tNs,
      r: 0.62 - 0.004 * pulse - 0.002 * Math.sin((2 * Math.PI * tS) / 4),
      g: 0.11,
      b: 0.04,
    });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

const CONTEXT: ReadingContext = {
  captureFps: 60,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: { ms: NOW_MS, day: '2026-10-04' },
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};
// SQI scores are only needed for "high" confidence; one passing window per second.
const PASSING_SQI = {
  threshold: 0.5,
  windows: Array.from({ length: 91 }, (_, k) => ({ endNs: CLOCK_START_NS + (k + 4) * 1e9, pClean: 0.9 })),
};
const BASE = analyzeReading(cleanCapture(), { ...CONTEXT, sqi: PASSING_SQI });

function analysisWith(
  overrides: Partial<ReadingAnalysis> = {},
  context: Partial<ReadingContext> = {},
): ReadingAnalysis {
  return { ...BASE, ...overrides, context: { ...BASE.context, ...context } };
}

const NO_MODELS: ModelOutputs = { rhythm: null, diabetes: null };
const PROFILE: Profile = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };
const windows = BASE.rhythmWindows.length;
const rhythmOf = (probs: [number, number, number], tauAf = 0.5): ModelOutputs => ({
  rhythm: { windowProbs: new Array(windows).fill(probs), tauAf },
  diabetes: null,
});
const SINUS = rhythmOf([0.9, 0.05, 0.05]);
const AF = rhythmOf([0.05, 0.9, 0.05]);

function evidenceWith(metric: string, label: string, passed: boolean): EvidenceFile {
  return { metrics: { ...seedEvidence.metrics, [metric]: { label, passed } } };
}

const build = (
  analysis: ReadingAnalysis,
  models: ModelOutputs = SINUS,
  evidence: EvidenceFile = seedEvidence,
  profile: Profile = PROFILE,
  history: PastReading[] = [],
) => buildReadingResult(analysis, models, evidence, profile, history);

// Owner 2026-10-06 ("Advisory + tag"): SQI-Net's low scores tag the reading and cap confidence at moderate; they
// never stop the count, never hide a flag the rules raise, and never drop a value to low confidence on their own.
// Owner 2026-10-09: "make the standards for a good reading lower": the tag needs at least
// dsp3.sqiFlaggedTagShare of the scored windows flagged.
describe('advisory SQI-Net (sqiFlagged)', () => {
  const flagged = analysisWith({ sqiFlagged: { windows: 46, total: 91 } });

  it('tags every value with the flagged windows, at moderate confidence', () => {
    expect(46 / 91).toBeGreaterThan(DSP_CONFIG.dsp3.sqiFlaggedTagShare);
    const outcome = build(flagged, AF);
    expect(outcome.quality).toEqual({
      level: 'low',
      reasons: [{ kind: 'sqiFlagged', windows: 46, total: 91 }],
    });
    const { hr, rhythm, rmssd, resp } = outcome.metrics;
    for (const metric of [hr, rhythm, resp])
      expect(metric).toMatchObject({
        quality: 'low',
        qualityReasons: ['sqiFlagged'],
        confidence: 'moderate',
      });
    expect(rmssd).toBeNull();
    expect(outcome.experimental).toMatchObject({ quality: 'low', qualityReasons: ['sqiFlagged'] });
    expect(build(flagged).metrics.rmssd!.value).toBe(build(BASE).metrics.rmssd!.value);
  });

  it('keeps the irregular flag and the heart-rate flags the rules raise', () => {
    expect(build(flagged, AF).metrics.rhythm).toMatchObject({ class: 'af', flag: 'irregular' });
    const slow = analysisWith({ sqiFlagged: { windows: 46, total: 91 }, heartRateBpm: 45 });
    expect(build(slow).metrics.hr).toMatchObject({ flag: 'slowResting', quality: 'low' });
  });

  // Owner 2026-10-09, reverting c93617d's "no class" rule: "dont keep that, state the result but state that its
  // low quality". Red team on #299 found pure noise SQI-Net flagged everywhere reads "Possible AFib"; that call
  // now shows tagged sqiFlagged.
  it('keeps the rhythm class and flag, tagged, when SQI-Net flagged more than half its windows', () => {
    const past: PastReading = { atMs: NOW_MS - HOUR_MS, rhythmPositive: true, rmssdMs: null, diabetes: null };
    const mostly = build(flagged, AF, seedEvidence, PROFILE, [past]);
    expect(mostly.metrics.rhythm).toMatchObject({ class: 'af', flag: 'possibleAf', quality: 'low' });
    expect(mostly.metrics.rhythm!.qualityReasons).toContain('sqiFlagged');
    expect(mostly.metrics.rhythm!.pAF).not.toBeNull();
    expect(mostly.headlineKey).toBe('result.possibleAf');
  });

  it('tags a reading with exactly the share of windows flagged', () => {
    expect(45 / 90).toBe(DSP_CONFIG.dsp3.sqiFlaggedTagShare);
    const half = build(analysisWith({ sqiFlagged: { windows: 45, total: 90 } }), AF);
    expect(half.quality.reasons).toEqual([{ kind: 'sqiFlagged', windows: 45, total: 90 }]);
    expect(half.metrics.hr).toMatchObject({ quality: 'low', confidence: 'moderate' });
  });

  it('leaves a reading with under the share of windows flagged standard', () => {
    expect(44 / 89).toBeLessThan(DSP_CONFIG.dsp3.sqiFlaggedTagShare);
    for (const sqiFlagged of [
      { windows: 0, total: 91 },
      { windows: 1, total: 91 },
      { windows: 44, total: 89 },
    ]) {
      const outcome = build(analysisWith({ sqiFlagged }), AF);
      expect(outcome.quality.reasons.map((reason) => reason.kind)).not.toContain('sqiFlagged');
      expect(outcome.metrics.rhythm).toMatchObject({ class: 'af', flag: 'irregular' });
      expect(outcome.metrics.hr!.qualityReasons).not.toContain('sqiFlagged');
    }
    expect(build(analysisWith({ sqiFlagged: { windows: 1, total: 91 } }))).toEqual(build(BASE));
  });

  it('adds nothing when SQI-Net never ran', () => {
    const noModel = build(analysisWith({ sqiFlagged: null, sqiAvailable: false }));
    expect(noModel.quality.reasons.map((reason) => reason.kind)).not.toContain('sqiFlagged');
  });
});

// Owner 2026-10-09: "A fingertip held over pure noise showing a heart rate, should be tagged as low quality." SQI-Net
// is the only check that tells noise from a pulse, so a rate it did not score is tagged: noSqi when it never ran,
// sqiUnscored when it stopped partway (red team on #299: 85 unscored seconds of noise read standard at high).
describe('heart rate SQI-Net did not score', () => {
  const scoredWhere = (keep: (k: number) => boolean) =>
    analyzeReading(cleanCapture(), {
      ...CONTEXT,
      sqi: { ...PASSING_SQI, windows: PASSING_SQI.windows.filter((_, k) => keep(k)) },
    });

  it('tags the rate noSqi when SQI-Net never ran, at moderate confidence', () => {
    const hr = build(analyzeReading(cleanCapture(), CONTEXT), NO_MODELS).metrics.hr!;
    expect(hr).toMatchObject({ quality: 'low', qualityReasons: ['noSqi'], confidence: 'moderate' });
    expect(hr.value).toBe(BASE.heartRateBpm);
  });

  it('tags the rate sqiUnscored when SQI-Net stopped after 10 s, and caps confidence at moderate', () => {
    const stopped = scoredWhere((k) => k < 7);
    expect(stopped.sqiUnscoredS).toBeGreaterThan(80);
    const outcome = build(stopped, AF);
    expect(outcome.metrics.hr).toMatchObject({ quality: 'low', confidence: 'moderate' });
    expect(outcome.metrics.hr!.qualityDetails).toContainEqual({
      kind: 'sqiUnscored',
      seconds: stopped.sqiUnscoredS,
    });
    expect(outcome.metrics.rhythm!.confidence).not.toBe('high');
    expect(outcome.quality.level).toBe('low');
  });

  it('does not tag a slow phone that scores every third window, or a last score still running', () => {
    const everyThird = scoredWhere((k) => k % 3 === 0);
    expect(everyThird.sqiUnscoredS).toBeLessThanOrEqual(DSP_CONFIG.dsp3.sqiUnscoredMaxS);
    expect(build(everyThird).metrics.hr).toMatchObject({ quality: 'standard', confidence: 'high' });
    const tailMissing = scoredWhere((k) => k < 89);
    expect(tailMissing.sqiUnscoredS).toBeLessThanOrEqual(DSP_CONFIG.dsp3.sqiUnscoredMaxS);
    expect(build(tailMissing).metrics.hr!.quality).toBe('standard');
  });

  it('counts only clean seconds no scored window covers', () => {
    expect(BASE.sqiUnscoredS).toBeLessThan(1.01);
    expect(analyzeReading(cleanCapture(), CONTEXT).sqiUnscoredS).toBeNull();
    const motion = { startNs: CLOCK_START_NS + 20e9, endNs: CLOCK_START_NS + 95e9 };
    const stoppedInMotion = analyzeReading(cleanCapture(), {
      ...CONTEXT,
      motionSpans: [motion],
      sqi: { ...PASSING_SQI, windows: PASSING_SQI.windows.filter((_, k) => k < 17) },
    });
    expect(stoppedInMotion.sqiUnscoredS).toBeLessThan(0.01);
  });

  it('never moves the retake prompt', () => {
    expect(build(scoredWhere((k) => k < 7)).retakePrompt).toBeNull();
  });
});

describe('ReadingResult shape', () => {
  it('copies counts and losses, and always lists what was not checked', () => {
    const outcome = build(BASE);
    const kept = BASE.segments.flat().filter((beat) => beat.beatClass !== 'not-a-beat');
    expect(outcome.cleanSeconds).toBe(BASE.cleanSeconds);
    expect(outcome.beats).toBe(kept.length);
    expect(outcome.rejectedBeats).toBe(kept.filter((beat) => beat.beatClass === 'artifact').length);
    expect(outcome.lostSeconds).toEqual(BASE.lostSeconds);
    expect(outcome.notChecked).toEqual(['bp', 'spo2', 'heartAttack']);
  });

  it('reports the experimental extra-beat rate, long pauses, and pulse-shape availability', () => {
    const outcome = build(BASE);
    const atypical = BASE.segments.flat().filter((beat) => beat.beatClass === 'atypical').length;
    expect(outcome.experimental.extraBeatsPerMin).toBeCloseTo(atypical / (BASE.cleanSeconds / 60), 12);
    expect(outcome.experimental.longPauses).toBe(
      BASE.segments.flat().filter((beat) => beat.longPause).length,
    );
    expect(outcome.experimental.pulseShape).toEqual({ available: true });
    // Available exactly when analyzeReading found a DSP-14 averaged beat.
    expect(build(analysisWith({ pulseShape: null })).experimental.pulseShape).toEqual({ available: false });
  });
});

describe('evidence labels come only from evidence.json (EVID-1)', () => {
  it('are all experimental with the seed file', () => {
    const { metrics } = build(BASE);
    expect(metrics.hr!.evidence).toBe('experimental');
    expect(metrics.rhythm!.evidence).toBe('experimental');
    expect(metrics.rmssd!.evidence).toBe('experimental');
    expect(metrics.resp!.evidence).toBe('experimental');
  });

  it('show a label only when the file says it and passed is true', () => {
    expect(build(BASE, SINUS, evidenceWith('hr', 'checked', true)).metrics.hr!.evidence).toBe('checked');
    expect(build(BASE, SINUS, evidenceWith('hr', 'checked', false)).metrics.hr!.evidence).toBe(
      'experimental',
    );
    expect(build(BASE, SINUS, evidenceWith('rhythm', 'public-data', true)).metrics.rhythm!.evidence).toBe(
      'public-data',
    );
    expect(build(BASE, SINUS, evidenceWith('hrv', 'checked', true)).metrics.rmssd!.evidence).toBe('checked');
    expect(build(BASE, SINUS, evidenceWith('resp', 'great', true)).metrics.resp!.evidence).toBe(
      'experimental',
    );
    expect(build(BASE, SINUS, { metrics: {} }).metrics.hr!.evidence).toBe('experimental');
  });

  it('never rate a rule-scored rhythm card above experimental, whatever the file says (§11.10)', () => {
    const publicData = evidenceWith('rhythm', 'public-data', true);
    const byRule: ModelOutputs = { ...SINUS, rhythm: { ...SINUS.rhythm!, scorer: 'rule' } };
    const byModel: ModelOutputs = { ...SINUS, rhythm: { ...SINUS.rhythm!, scorer: 'model' } };
    expect(build(BASE, byRule, publicData).metrics.rhythm).toMatchObject({
      evidence: 'experimental',
      scorer: 'rule',
    });
    expect(build(BASE, byModel, publicData).metrics.rhythm).toMatchObject({
      evidence: 'public-data',
      scorer: 'model',
    });
    // A reading saved before the rule fallback has no scorer and keeps the model's label.
    expect(build(BASE, SINUS, publicData).metrics.rhythm!.evidence).toBe('public-data');
  });
});

describe('confidence (§7)', () => {
  it('is high with full coverage, SQI scores, a Full phone, and a confident rhythm model', () => {
    const { metrics } = build(BASE);
    expect(metrics.hr!.confidence).toBe('high');
    expect(metrics.rhythm!.confidence).toBe('high');
  });

  it('drops to moderate below 90% clean coverage and to low below 70%', () => {
    expect(build(analysisWith({ cleanSeconds: 0.89 * BASE.durationS })).metrics.hr!.confidence).toBe(
      'moderate',
    );
    expect(build(analysisWith({ cleanSeconds: 0.69 * BASE.durationS })).metrics.hr!.confidence).toBe('low');
  });

  it('is at most moderate without SQI scores, on a Limited phone, or on an unrated phone', () => {
    expect(build(analysisWith({ sqiAvailable: false })).metrics.hr!.confidence).toBe('moderate');
    expect(build(analysisWith({}, { tier: 'limited' })).metrics.hr!.confidence).toBe('moderate');
    expect(build(analysisWith({}, { tier: null })).metrics.hr!.confidence).toBe('moderate');
    expect(build(analysisWith({}, { tier: 'basic' })).metrics.hr!.confidence).toBe('high');
  });

  it('caps the rhythm card by the top probability: < 0.8 moderate, < 0.6 low', () => {
    expect(build(BASE, rhythmOf([0.7, 0.2, 0.1])).metrics.rhythm!.confidence).toBe('moderate');
    expect(build(BASE, rhythmOf([0.5, 0.3, 0.2])).metrics.rhythm!.confidence).toBe('low');
  });
});

describe('§10.1 heart-rate flags', () => {
  const at = (bpm: number, overrides: Partial<ReadingAnalysis> = {}, profile = PROFILE, context = {}) =>
    build(analysisWith({ heartRateBpm: bpm, ...overrides }, context), SINUS, seedEvidence, profile).metrics
      .hr!;

  it('flags slow resting below 50 bpm, or below 40 for athletes and beta-blockers', () => {
    expect(at(49.9).flag).toBe('slowResting');
    expect(at(50).flag).toBeNull();
    expect(at(45, {}, { ...PROFILE, athlete: true }).flag).toBeNull();
    expect(at(39.9, {}, { ...PROFILE, athlete: true }).flag).toBe('slowResting');
    expect(at(45, {}, { ...PROFILE, betaBlocker: true }).flag).toBeNull();
  });

  it('flags fast resting above 100 bpm', () => {
    expect(at(100).flag).toBeNull();
    expect(at(100.1).flag).toBe('fastResting');
  });

  it('flags fast regular (over fast resting) at 130–220 bpm with normalized RMSSD < 0.03', () => {
    expect(at(150, { normalizedRmssd: 0.02 }).flag).toBe('fastRegular');
    expect(at(130, { normalizedRmssd: 0.02 }).flag).toBe('fastRegular');
    expect(at(150, { normalizedRmssd: 0.03 }).flag).toBe('fastResting');
    expect(at(220.5, { normalizedRmssd: 0.02 }).flag).toBe('fastResting');
  });

  it('needs the rest timer and 30 clean seconds; the value is still shown', () => {
    const noRest = at(45, {}, PROFILE, { restTimerDone: false });
    expect(noRest).toMatchObject({ value: 45, flag: null });
    expect(at(45, { cleanSeconds: 29.9, durationS: 30 }).flag).toBeNull();
    expect(at(45, { cleanSeconds: 30, durationS: 30 }).flag).toBe('slowResting');
  });

  it('never flags with low confidence', () => {
    expect(at(45, { cleanSeconds: 0.6 * BASE.durationS })).toMatchObject({ confidence: 'low', flag: null });
  });

  it('gives no HR card and an inconclusive headline when DSP-11 has no rate', () => {
    const outcome = build(analysisWith({ heartRateBpm: null }));
    expect(outcome.metrics.hr).toBeNull();
    expect(outcome.headlineKey).toBe('result.inconclusive');
  });
});

describe('rhythm card, headline, and the 2-of-3 rule', () => {
  it('is regular for a confident sinus reading, with pAF as the window mean', () => {
    const models = {
      ...SINUS,
      rhythm: {
        ...SINUS.rhythm!,
        windowProbs: SINUS.rhythm!.windowProbs.map((p, k) =>
          k === 0 ? ([0.8, 0.15, 0.05] as [number, number, number]) : p,
        ),
      },
    };
    const outcome = build(BASE, models);
    expect(outcome.headlineKey).toBe('result.regular');
    expect(outcome.metrics.rhythm).toMatchObject({ class: 'sinus', flag: null });
    expect(outcome.metrics.rhythm!.pAF).toBeCloseTo((0.15 + 0.05 * (windows - 1)) / windows, 12);
  });

  it('is uncertain when the top probability is < 0.6, and never flags', () => {
    const outcome = build(BASE, rhythmOf([0.3, 0.55, 0.15], 0.5));
    expect(outcome.headlineKey).toBe('result.uncertain');
    expect(outcome.metrics.rhythm!.flag).toBeNull();
  });

  // A rhythm nobody judged is neither claimed regular (ADR 0041) nor a reason to retake a good heart rate.
  it('states only the heart rate when no rhythm model output exists', () => {
    const outcome = build(BASE, NO_MODELS);
    expect(outcome.metrics.rhythm).toBeNull();
    expect(outcome.headlineKey).toBe('result.hrOnly');
  });

  // Owner 2026-10-06 (ADR 0104 answer 4): Quick tags only the values that miss a floor.
  it('runs the rhythm check on a Quick Check too, tagged only for the floor it missed', () => {
    const quick = analysisWith({ cleanSeconds: 30, durationS: 30 }, { mode: 'quick' });
    const outcome = build(quick, SINUS);
    expect(outcome.metrics.hr).toMatchObject({
      value: BASE.heartRateBpm,
      quality: 'standard',
      qualityReasons: [],
    });
    expect(outcome.metrics.rhythm).toMatchObject({
      class: 'sinus',
      quality: 'low',
      qualityReasons: ['shortClean'],
      qualityDetails: [{ kind: 'shortClean', haveS: 30, wantS: 60 }],
      confidence: 'low',
    });
    expect(outcome.headlineKey).toBe('result.regular');
    expect(outcome.quality.level).toBe('low');
    expect(outcome.quality.reasons.map((reason) => reason.kind)).not.toContain('quickMode');
    expect(outcome.quality.reasons).toContainEqual({ kind: 'shortClean', haveS: 30, wantS: 60 });
    // With no rhythm model at all, nothing judged the rhythm.
    expect(build(quick, NO_MODELS).headlineKey).toBe('result.hrOnly');
  });

  it('a standard reading is standard everywhere, with no reasons, in either mode', () => {
    for (const mode of ['full', 'quick'] as const) {
      const outcome = build(analysisWith({}, { mode }));
      expect(outcome.quality).toEqual({ level: 'standard', reasons: [] });
    }
    const outcome = build(BASE);
    const { hr, rhythm, rmssd, resp } = outcome.metrics;
    for (const metric of [hr, rhythm, rmssd, resp, outcome.experimental])
      expect(metric).toMatchObject({ quality: 'standard', qualityReasons: [], qualityDetails: [] });
  });

  it('states only the heart rate with a pacemaker, whatever the rhythm model says', () => {
    const outcome = build(BASE, AF, seedEvidence, { ...PROFILE, pacemaker: true });
    expect(outcome.headlineKey).toBe('result.hrOnly');
  });

  it('keeps "Couldn’t tell" for a judged rhythm under the top-probability line, sinus on top', () => {
    const outcome = build(BASE, rhythmOf([0.5, 0.3, 0.2]));
    expect(outcome.metrics.rhythm).toMatchObject({ class: 'sinus', confidence: 'low' });
    expect(outcome.headlineKey).toBe('result.uncertain');
  });

  it('flags irregular when pAF ≥ τ_AF with high confidence, 60 clean s, and 40 intervals', () => {
    const outcome = build(BASE, AF);
    expect(outcome.metrics.rhythm).toMatchObject({ class: 'af', flag: 'irregular', confidence: 'high' });
    expect(outcome.headlineKey).toBe('result.irregularRetake');
    expect(build(BASE, rhythmOf([0.05, 0.9, 0.05], 0.95)).metrics.rhythm!.flag).toBeNull();
  });

  it('flags a confident irregular call below high reading confidence, tagged with why (owner, ADR 0104)', () => {
    const outcome = build(analysisWith({ sqiAvailable: false }), AF);
    expect(outcome.metrics.rhythm).toMatchObject({
      class: 'af',
      flag: 'irregular',
      confidence: 'low',
      quality: 'low',
      qualityReasons: ['noSqi'],
    });
    expect(outcome.headlineKey).toBe('result.irregularRetake');
    expect(outcome.quality.reasons).toEqual([{ kind: 'noSqi' }]);
    const patchy = build(analysisWith({ cleanSeconds: 0.8 * BASE.durationS }), AF).metrics.rhythm!;
    expect(patchy).toMatchObject({ flag: 'irregular', qualityReasons: ['contact'] });
  });

  it('still holds the flag when the model is unsure (top probability < 0.8) or the phone is unrated', () => {
    const unsure = build(BASE, rhythmOf([0.25, 0.7, 0.05]));
    expect(unsure.metrics.rhythm).toMatchObject({ class: 'af', flag: null, quality: 'standard' });
    expect(unsure.headlineKey).toBe('result.irregularRetake');
    const unrated = build(analysisWith({}, { tier: null }), AF).metrics.rhythm!;
    expect(unrated).toMatchObject({ flag: null, quality: 'standard' });
  });

  it('counts a lower-quality positive toward possible AFib', () => {
    const past: PastReading = { atMs: NOW_MS - HOUR_MS, rhythmPositive: true, rmssdMs: null, diabetes: null };
    const quick = analysisWith({ cleanSeconds: 30, durationS: 30, sqiAvailable: false }, { mode: 'quick' });
    const outcome = build(quick, AF, seedEvidence, PROFILE, [past]);
    expect(outcome.metrics.rhythm).toMatchObject({ flag: 'possibleAf', quality: 'low' });
    expect(outcome.headlineKey).toBe('result.possibleAf');
  });

  it('tags the rhythm card below 60 clean seconds, 40 usable intervals, or one window (ADR 0104)', () => {
    const short = build(analysisWith({ cleanSeconds: 59.9, durationS: 60 }), SINUS).metrics.rhythm!;
    expect(short).toMatchObject({ class: 'sinus', quality: 'low', qualityReasons: ['shortClean'] });
    const few = build(analysisWith({ enoughRhythmIntervals: false, usableRhythmIntervals: 12 }), SINUS);
    expect(few.metrics.rhythm).toMatchObject({ quality: 'low', qualityReasons: ['fewBeats'] });
    expect(few.quality.reasons).toEqual([{ kind: 'fewBeats', beats: 12, wantBeats: 40 }]);

    const oneWide = analysisWith({
      rhythmWindows: [],
      rhythmFeatures: [],
      lowQuality: {
        ...BASE.lowQuality,
        rhythmWindow: BASE.rhythmWindows[0]!,
        rhythmFeatures: BASE.rhythmFeatures[0]!,
      },
    });
    const oneRow: ModelOutputs = { rhythm: { windowProbs: [[0.9, 0.05, 0.05]], tauAf: 0.5 }, diabetes: null };
    expect(build(oneWide, oneRow).metrics.rhythm).toMatchObject({
      class: 'sinus',
      quality: 'low',
      qualityReasons: ['fewWindows'],
    });
    expect(() => build(oneWide, SINUS)).toThrow(RangeError);
  });

  it('gives no rhythm card with no row to score at all', () => {
    const none = analysisWith({ rhythmWindows: [], rhythmFeatures: [] });
    expect(
      build(none, { rhythm: { windowProbs: [], tauAf: 0.5 }, diabetes: null }).metrics.rhythm,
    ).toBeNull();
  });

  it('names basic analysis as the reason when the logistic rule scored the rhythm', () => {
    const basic: ModelOutputs = { rhythm: { ...SINUS.rhythm!, scorer: 'rule' }, diabetes: null };
    expect(build(BASE, basic).metrics.rhythm).toMatchObject({
      scorer: 'rule',
      evidence: 'experimental',
      quality: 'low',
      qualityReasons: ['modelFallback'],
    });
  });

  it('refuses window probabilities that do not match the DSP-15 windows', () => {
    const oneExtra: ModelOutputs = {
      rhythm: { windowProbs: [...SINUS.rhythm!.windowProbs, [1, 0, 0]], tauAf: 0.5 },
      diabetes: null,
    };
    expect(() => build(BASE, oneExtra)).toThrow(RangeError);
  });

  // A NaN row once became a card with no class and P(AF) NaN under an "irregular, retake" headline.
  it.each([
    ['a NaN', [Number.NaN, 0.5, 0.5]],
    ['an infinite', [Infinity, 0, 0]],
    ['a negative', [1.1, -0.1, 0]],
    ['a non-normalised', [0.5, 0.2, 0.2]],
  ] as [string, [number, number, number]][])('refuses %s window probability row', (_, bad) => {
    const rows = [...SINUS.rhythm!.windowProbs];
    rows[rows.length - 1] = bad;
    const outputs: ModelOutputs = { rhythm: { windowProbs: rows, tauAf: 0.5 }, diabetes: null };
    expect(() => build(BASE, outputs)).toThrow(/probabilit/);
    expect(() => build(BASE, outputs, seedEvidence, { ...PROFILE, pacemaker: true })).toThrow(RangeError);
  });

  // The app drops just the rhythm card on a row this rejects, so it must agree with buildReadingResult.
  it('exports the same row check that buildReadingResult applies', () => {
    const float32Row = Array.from(Float32Array.from([0.9, 0.05, 0.05]));
    expect(isProbabilityRow(float32Row)).toBe(true);
    expect(isProbabilityRow([0.5, 0.2, 0.2])).toBe(false);
    expect(isProbabilityRow([Number.NaN, 0.5, 0.5])).toBe(false);
    expect(isProbabilityRow([0.5, 0.5])).toBe(false);
  });

  it('accepts a row that sums to 1 only within float32 rounding, as ONNX Runtime returns it', () => {
    const float32Row = Array.from(Float32Array.from([0.9, 0.05, 0.05])) as [number, number, number];
    expect(build(BASE, rhythmOf(float32Row)).metrics.rhythm!.class).toBe('sinus');
  });

  it('turns rhythm screening off with a pacemaker, and rhythm flags off with known AFib', () => {
    expect(build(BASE, AF, seedEvidence, { ...PROFILE, pacemaker: true }).metrics.rhythm).toBeNull();
    expect(build(BASE, AF, seedEvidence, { ...PROFILE, knownAf: true }).metrics.rhythm!.flag).toBeNull();
  });

  const past = (hoursAgo: number, rhythmPositive: boolean): PastReading => ({
    atMs: NOW_MS - hoursAgo * HOUR_MS,
    rhythmPositive,
    rmssdMs: null,
    diabetes: null,
  });

  it('shows possible AFib when 2 of the last 3 readings within 24 h are positive', () => {
    const outcome = build(BASE, AF, seedEvidence, PROFILE, [past(3, true)]);
    expect(outcome.metrics.rhythm!.flag).toBe('possibleAf');
    expect(outcome.headlineKey).toBe('result.possibleAf');
    expect(build(BASE, AF, seedEvidence, PROFILE, [past(2, false), past(5, true)]).metrics.rhythm!.flag).toBe(
      'possibleAf',
    );
  });

  it('stays irregular when the other positive is older than 24 h or not among the last three', () => {
    expect(build(BASE, AF, seedEvidence, PROFILE, [past(25, true)]).metrics.rhythm!.flag).toBe('irregular');
    expect(
      build(BASE, AF, seedEvidence, PROFILE, [past(1, false), past(2, false), past(3, true)]).metrics.rhythm!
        .flag,
    ).toBe('irregular');
  });

  it('cannot use history when the reading time is unknown', () => {
    const unknownTime = analysisWith({}, { recordedAt: null });
    expect(build(unknownTime, AF, seedEvidence, PROFILE, [past(3, true)]).metrics.rhythm!.flag).toBe(
      'irregular',
    );
  });
});

describe('each card carries its own floors (ADR 0104)', () => {
  it('a 12 s reading: the heart rate quotes 15 s, the rhythm 60 s, while the reading lists the largest', () => {
    const short = analysisWith({ heartRateBpm: null, cleanSeconds: 12, durationS: 12 });
    const lowHr = { ...short, lowQuality: { ...short.lowQuality, heartRateBpm: 64 } };
    const outcome = build(lowHr, SINUS);
    expect(outcome.metrics.hr!.qualityDetails).toEqual([{ kind: 'shortClean', haveS: 12, wantS: 15 }]);
    expect(outcome.metrics.rhythm!.qualityDetails).toContainEqual({
      kind: 'shortClean',
      haveS: 12,
      wantS: 60,
    });
    expect(outcome.quality.reasons).toContainEqual({ kind: 'shortClean', haveS: 12, wantS: 60 });
  });
});

describe('basic analysis: the logistic rule feeds the same rhythm decision (§11.1, §11.10)', () => {
  const ABSTAIN = DSP_CONFIG.rules.uncertainBelowTopProb;
  const EPS = 1e-6;
  const entryWith = (rule: object, tauAf: number) => ({
    inputs: ruleFixture.inputs,
    threshold: { af: tauAf },
    abstainBelow: ABSTAIN,
    rule,
  });
  // Zero coefficients make every window's probabilities softmax(log probs) = probs.
  const constantRule = (probs: number[]) => ({
    ...ruleFixture.rule,
    classes: ['sinus', 'af', 'other'],
    coefficients: ruleFixture.rule.coefficients.map((row) => row.map(() => 0)),
    intercepts: probs.map(Math.log),
  });
  const ruleModels = (probs: number[], tauAf: number): ModelOutputs => ({
    rhythm: logisticRhythmOutputs(entryWith(constantRule(probs), tauAf), BASE.rhythmFeatures),
    diabetes: null,
  });
  const withTop = (top: number) => [top, (1 - top) / 2, (1 - top) / 2];

  it('scores every DSP-15 window, and the card reports their mean P(AF)', () => {
    const rhythm = logisticRhythmOutputs(entryWith(ruleFixture.rule, 0.5), BASE.rhythmFeatures);
    const meanAf = rhythm.windowProbs.reduce((total, probs) => total + probs[1], 0) / windows;
    expect(rhythm.windowProbs).toHaveLength(windows);
    expect(build(BASE, { rhythm, diabetes: null }).metrics.rhythm!.pAF).toBeCloseTo(meanAf, 12);
  });

  it('abstains just below the top-probability line and answers just above it', () => {
    const below = build(BASE, ruleModels(withTop(ABSTAIN - EPS), 0.5));
    expect(below.headlineKey).toBe('result.uncertain');
    expect(below.metrics.rhythm).toMatchObject({ class: 'sinus', confidence: 'low', flag: null });
    const above = build(BASE, ruleModels(withTop(ABSTAIN + EPS), 0.5));
    expect(above.headlineKey).toBe('result.regular');
    expect(above.metrics.rhythm!.confidence).toBe('moderate');
  });

  it('flags irregular when the mean P(AF) reaches τ_AF, and not just below it', () => {
    const probs = [0.05, 0.9, 0.05];
    expect(build(BASE, ruleModels(probs, 0.9 - EPS)).metrics.rhythm!.flag).toBe('irregular');
    expect(build(BASE, ruleModels(probs, 0.9 + EPS)).metrics.rhythm!.flag).toBeNull();
  });
});

describe('RMSSD card (DSP-12, §6.2 Full tier)', () => {
  it('reports RMSSD for a sinus reading on a Full phone at ≥ 60 fps', () => {
    const rmssd = build(BASE).metrics.rmssd!;
    expect(rmssd.value).toBeGreaterThan(0);
    expect(rmssd.band).toBeNull();
  });

  it('is absent when the rhythm was judged and is not confidently sinus, or with a pacemaker', () => {
    expect(build(BASE, AF).metrics.rmssd).toBeNull();
    expect(build(BASE, rhythmOf([0.55, 0.3, 0.15])).metrics.rmssd).toBeNull();
    expect(build(BASE, NO_MODELS, seedEvidence, { ...PROFILE, pacemaker: true }).metrics.rmssd).toBeNull();
  });

  it('is tagged lower quality below its tier, frame rate, or sinus judgement (ADR 0104)', () => {
    const standard = build(BASE).metrics.rmssd!.value;
    // No model or rule judged the rhythm at all: the reason says so, not that a simpler method was used.
    expect(build(BASE, NO_MODELS).metrics.rmssd).toMatchObject({
      value: standard,
      quality: 'low',
      qualityReasons: ['rhythmUnjudged'],
      qualityDetails: [{ kind: 'rhythmUnjudged' }],
    });
    // A 60 fps phone rated Basic (§5.2 weighs the score too) is told about its rating, not its frame rate.
    const basic = build(analysisWith({}, { tier: 'basic' }));
    expect(basic.metrics.rmssd).toMatchObject({ value: standard, qualityReasons: ['phoneTier'] });
    expect(basic.quality.reasons).toContainEqual({ kind: 'phoneTier', tier: 'basic', wantTier: 'full' });
    const slow = build(analysisWith({}, { captureFps: 30 }));
    expect(slow.metrics.rmssd).toMatchObject({ value: standard, qualityReasons: ['lowFps'] });
    expect(slow.quality.reasons).toContainEqual({ kind: 'lowFps', fps: 30, wantFps: 60 });
  });

  it('validation only: a labelled sinus rhythm opens the DSP-12 gate when no rhythm model ran', () => {
    const labelled = analysisWith({}, { validationRhythmLabel: 'sinus' });
    const outcome = build(labelled, NO_MODELS);
    expect(outcome.metrics.rmssd!.value).toBeCloseTo(build(BASE).metrics.rmssd!.value, 12);
    // The label never makes a rhythm card or changes the headline.
    expect(outcome.metrics.rhythm).toBeNull();
    expect(outcome.headlineKey).toBe('result.hrOnly');
    expect(outcome.metrics.rmssd!.quality).toBe('standard');
    expect(build(analysisWith({}, { validationRhythmLabel: 'af' }), NO_MODELS).metrics.rmssd).toBeNull();
    const basicTier = analysisWith({}, { validationRhythmLabel: 'sinus', tier: 'basic' });
    expect(build(basicTier, NO_MODELS).metrics.rmssd!.quality).toBe('low');
  });

  it('ignores the rhythm label whenever a rhythm model output is supplied', () => {
    expect(build(analysisWith({}, { validationRhythmLabel: 'sinus' }), AF).metrics.rmssd).toBeNull();
  });

  it('adds the personal band (median ± 1.5 IQR) after 7 earlier readings', () => {
    const history = [40, 42, 44, 46, 48, 50, 52].map((rmssdMs, k) => ({
      atMs: NOW_MS - (k + 1) * 24 * HOUR_MS,
      rhythmPositive: false,
      rmssdMs,
      diabetes: null,
    }));
    // Quartiles by linear interpolation (numpy's default): 43 and 49, IQR 6, median 46.
    expect(build(BASE, SINUS, seedEvidence, PROFILE, history).metrics.rmssd!.band).toEqual([37, 55]);
    expect(build(BASE, SINUS, seedEvidence, PROFILE, history.slice(1)).metrics.rmssd!.band).toBeNull();
  });
});

describe('breathing card (DSP-13, §6.2 Basic tier)', () => {
  it('reports the fused rate on Basic and Full phones, and tags it on Limited ones', () => {
    expect(build(BASE).metrics.resp!.value).toBeCloseTo(BASE.breathing!.rateBrpm!, 12);
    expect(build(analysisWith({}, { tier: 'basic' })).metrics.resp!.quality).toBe('standard');
    expect(build(analysisWith({}, { tier: 'limited' })).metrics.resp).toMatchObject({
      value: BASE.breathing!.rateBrpm,
      quality: 'low',
      qualityReasons: ['phoneTier'],
    });
    expect(build(analysisWith({}, { tier: null, captureFps: 24 })).metrics.resp!.qualityReasons).toEqual([
      'lowFps',
    ]);
  });

  it('keeps main’s standard path: a phone rated Basic is standard whatever its frame rate', () => {
    expect(build(analysisWith({}, { tier: 'basic', captureFps: 24 })).metrics.resp).toMatchObject({
      quality: 'standard',
      qualityReasons: [],
    });
  });

  it('infers the tier gate from the frame rate when the phone is unrated', () => {
    expect(build(analysisWith({}, { tier: null, captureFps: 30 })).metrics.resp!.quality).toBe('standard');
    expect(build(analysisWith({}, { tier: null, captureFps: 24 })).metrics.resp!.quality).toBe('low');
  });

  it('falls back to the interval estimate when the three disagree, tagged (ADR 0104)', () => {
    const disagree = { rateBrpm: null, intensityBrpm: 12, amplitudeBrpm: 24, intervalBrpm: 13 };
    const outcome = build(analysisWith({ breathing: disagree }));
    expect(outcome.metrics.resp).toMatchObject({
      value: 13,
      quality: 'low',
      qualityReasons: ['estimatesDisagree'],
    });
    expect(outcome.quality.reasons).toEqual([{ kind: 'estimatesDisagree' }]);
    const missing = { rateBrpm: null, intensityBrpm: 12, amplitudeBrpm: null, intervalBrpm: 13 };
    expect(build(analysisWith({ breathing: missing })).quality.reasons).toEqual([
      { kind: 'fewWindows', windows: 2, wantWindows: 3 },
    ]);
    const none = { rateBrpm: null, intensityBrpm: 12, amplitudeBrpm: null, intervalBrpm: null };
    expect(build(analysisWith({ breathing: none })).metrics.resp).toBeNull();
  });

  it('below 60 clean seconds uses the estimates without the floor, tagged short', () => {
    const lowBreathing = { rateBrpm: 15, intensityBrpm: 15, amplitudeBrpm: 15, intervalBrpm: 15 };
    const short = analysisWith({
      cleanSeconds: 40,
      durationS: 40,
      breathing: null,
      lowQuality: { ...BASE.lowQuality, breathing: lowBreathing },
    });
    expect(build(short).metrics.resp).toMatchObject({
      value: 15,
      quality: 'low',
      qualityReasons: ['shortClean'],
    });
  });
});

describe('diabetes card (§10.1, §11.4)', () => {
  const withDiabetes = (probability: number, tauDm = 0.5): ModelOutputs => ({
    ...SINUS,
    diabetes: { probability, tauDm },
  });
  const earlier = (
    day: string,
    probability: number,
    confidence: 'high' | 'moderate' | 'low' = 'high',
  ): PastReading => ({
    atMs: NOW_MS - 48 * HOUR_MS,
    rhythmPositive: false,
    rmssdMs: null,
    diabetes: { day, probability, confidence },
  });
  const passedDiabetes = evidenceWith('diabetes', 'public-data', true);

  it('flags the pattern from the mean of ≥ 2 Full Scans on different days, when ML-6 has passed', () => {
    const metric = build(BASE, withDiabetes(0.7), passedDiabetes, PROFILE, [earlier('2026-10-02', 0.5)])
      .metrics.diabetes!;
    expect(metric).toMatchObject({ readingsUsed: 2, evidence: 'public-data', flag: 'pattern' });
    expect(metric.probability).toBeCloseTo(0.6, 12);
  });

  it('does not flag on one day, below τ_DM, with a low-confidence reading, or without ML-6', () => {
    const sameDay = build(BASE, withDiabetes(0.7), passedDiabetes, PROFILE, [earlier('2026-10-04', 0.7)]);
    expect(sameDay.metrics.diabetes!.flag).toBeNull();
    expect(
      build(BASE, withDiabetes(0.3), passedDiabetes, PROFILE, [earlier('2026-10-02', 0.4)]).metrics.diabetes!
        .flag,
    ).toBeNull();
    expect(
      build(BASE, withDiabetes(0.7), passedDiabetes, PROFILE, [earlier('2026-10-02', 0.7, 'low')]).metrics
        .diabetes!.flag,
    ).toBeNull();
    const experimental = build(BASE, withDiabetes(0.7), seedEvidence, PROFILE, [earlier('2026-10-02', 0.7)]);
    expect(experimental.metrics.diabetes).toMatchObject({ evidence: 'experimental', flag: null });
  });

  it('below a Full Scan of 90 clean seconds on a Full phone is tagged and never flags (ADR 0104)', () => {
    const history = [earlier('2026-10-02', 0.7)];
    const cases: [Partial<ReadingAnalysis>, Partial<ReadingContext>, string][] = [
      [{}, { mode: 'quick' }, 'quickMode'],
      [{ cleanSeconds: 30, durationS: 30 }, { mode: 'quick' }, 'shortClean'],
      [{}, { tier: 'basic' }, 'phoneTier'],
      [{ cleanSeconds: 89.9, durationS: 89.9 }, {}, 'shortClean'],
    ];
    for (const [overrides, context, reason] of cases) {
      const analysis = analysisWith(overrides, context);
      const metric = build(analysis, withDiabetes(0.7), passedDiabetes, PROFILE, history).metrics.diabetes!;
      expect(metric).toMatchObject({ quality: 'low', flag: null, confidence: 'low' });
      expect(metric.qualityReasons).toContain(reason);
    }
    expect(build(analysisWith({}, { mode: 'deep' }), withDiabetes(0.7)).metrics.diabetes).toBeNull();
  });

  it('puts no non-finite frame rate in a reason (a format with no finite rate counts as 0 fps)', () => {
    for (const captureFps of [Number.NaN, Infinity, -Infinity, -60]) {
      const reasons = build(analysisWith({}, { captureFps }), withDiabetes(0.7)).quality.reasons;
      expect(reasons).toContainEqual({ kind: 'lowFps', fps: 0, wantFps: 60 });
      expect(JSON.stringify(reasons)).not.toMatch(/null|NaN|Infinity/);
    }
  });

  it('is tagged when a lower-quality rhythm call opened diabetes-net’s HRV summary, and never flags', () => {
    // A 90 s, 60 fps Full Scan with no 32-interval window: the rhythm comes from one reading-wide row.
    const oneWide = analysisWith({
      rhythmWindows: [],
      rhythmFeatures: [],
      lowQuality: {
        ...BASE.lowQuality,
        rhythmWindow: BASE.rhythmWindows[0]!,
        rhythmFeatures: BASE.rhythmFeatures[0]!,
      },
    });
    const models: ModelOutputs = {
      rhythm: { windowProbs: [[0.9, 0.05, 0.05]], tauAf: 0.5 },
      diabetes: { probability: 0.7, tauDm: 0.5 },
    };
    const diabetes = build(oneWide, models, passedDiabetes, PROFILE, [earlier('2026-10-02', 0.7)]).metrics
      .diabetes!;
    expect(diabetes).toMatchObject({ quality: 'low', flag: null });
    expect(diabetes.qualityReasons).toContain('fewWindows');
    // The same reading with a standard rhythm call still flags.
    const standard = build(BASE, { ...SINUS, diabetes: models.diabetes }, passedDiabetes, PROFILE, [
      earlier('2026-10-02', 0.7),
    ]).metrics.diabetes!;
    expect(standard).toMatchObject({ quality: 'standard', flag: 'pattern' });
  });

  it('names the lower-quality averaged beat when the model scored it', () => {
    const lowShape = { ...BASE.pulseShape!, beatsUsed: 5 };
    const analysis = analysisWith(
      { pulseShape: null, lowQuality: { ...BASE.lowQuality, pulseShape: lowShape } },
      { captureFps: 30, tier: 'full' },
    );
    expect(build(analysis, withDiabetes(0.7)).quality.reasons).toEqual(
      expect.arrayContaining([
        { kind: 'lowFps', fps: 30, wantFps: 60 },
        { kind: 'fewBeats', beats: 5, wantBeats: 20 },
      ]),
    );
  });
});
