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

  it('is uncertain with no rhythm model output: the headline never claims a regular rhythm', () => {
    const outcome = build(BASE, NO_MODELS);
    expect(outcome.metrics.rhythm).toBeNull();
    expect(outcome.headlineKey).toBe('result.uncertain');
  });

  it('flags irregular when pAF ≥ τ_AF with high confidence, 60 clean s, and 40 intervals', () => {
    const outcome = build(BASE, AF);
    expect(outcome.metrics.rhythm).toMatchObject({ class: 'af', flag: 'irregular', confidence: 'high' });
    expect(outcome.headlineKey).toBe('result.irregularRetake');
    expect(build(BASE, rhythmOf([0.05, 0.9, 0.05], 0.95)).metrics.rhythm!.flag).toBeNull();
  });

  it('says retake but does not flag an irregular-looking rhythm below high confidence', () => {
    const outcome = build(analysisWith({ sqiAvailable: false }), AF);
    expect(outcome.metrics.rhythm).toMatchObject({ class: 'af', flag: null, confidence: 'moderate' });
    expect(outcome.headlineKey).toBe('result.irregularRetake');
  });

  it('gives no rhythm card below 60 clean seconds, 40 usable intervals, or one window', () => {
    expect(build(analysisWith({ cleanSeconds: 59.9, durationS: 60 }), AF).metrics.rhythm).toBeNull();
    expect(build(analysisWith({ enoughRhythmIntervals: false }), AF).metrics.rhythm).toBeNull();
    expect(
      build(analysisWith({ rhythmWindows: [], rhythmFeatures: [] }), {
        rhythm: { windowProbs: [], tauAf: 0.5 },
        diabetes: null,
      }).metrics.rhythm,
    ).toBeNull();
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

  it('is absent unless the rhythm is confidently sinus, the tier is Full, and the capture runs at 60 fps', () => {
    expect(build(BASE, AF).metrics.rmssd).toBeNull();
    expect(build(BASE, rhythmOf([0.55, 0.3, 0.15])).metrics.rmssd).toBeNull();
    expect(build(BASE, NO_MODELS).metrics.rmssd).toBeNull();
    expect(build(analysisWith({}, { tier: 'basic' })).metrics.rmssd).toBeNull();
    expect(build(analysisWith({}, { captureFps: 30 })).metrics.rmssd).toBeNull();
  });

  it('validation only: a labelled sinus rhythm opens the DSP-12 gate when no rhythm model ran', () => {
    const labelled = analysisWith({}, { validationRhythmLabel: 'sinus' });
    const outcome = build(labelled, NO_MODELS);
    expect(outcome.metrics.rmssd!.value).toBeCloseTo(build(BASE).metrics.rmssd!.value, 12);
    // The label never makes a rhythm card or changes the headline.
    expect(outcome.metrics.rhythm).toBeNull();
    expect(outcome.headlineKey).toBe('result.uncertain');
    expect(build(analysisWith({}, { validationRhythmLabel: 'af' }), NO_MODELS).metrics.rmssd).toBeNull();
    expect(
      build(analysisWith({}, { validationRhythmLabel: 'sinus', tier: 'basic' }), NO_MODELS).metrics.rmssd,
    ).toBeNull();
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
  it('reports the fused rate on Basic and Full phones but not on Limited ones', () => {
    expect(build(BASE).metrics.resp!.value).toBeCloseTo(BASE.breathing!.rateBrpm!, 12);
    expect(build(analysisWith({}, { tier: 'basic' })).metrics.resp).not.toBeNull();
    expect(build(analysisWith({}, { tier: 'limited' })).metrics.resp).toBeNull();
  });

  it('infers the tier gate from the frame rate when the phone is unrated', () => {
    expect(build(analysisWith({}, { tier: null, captureFps: 30 })).metrics.resp).not.toBeNull();
    expect(build(analysisWith({}, { tier: null, captureFps: 24 })).metrics.resp).toBeNull();
  });

  it('is absent when the three estimates disagree', () => {
    const disagree = { rateBrpm: null, intensityBrpm: 12, amplitudeBrpm: 24, intervalBrpm: 12 };
    expect(build(analysisWith({ breathing: disagree })).metrics.resp).toBeNull();
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

  it('needs a Full Scan of 90 clean seconds on a Full phone', () => {
    expect(build(analysisWith({}, { mode: 'quick' }), withDiabetes(0.7)).metrics.diabetes).toBeNull();
    expect(build(analysisWith({}, { tier: 'basic' }), withDiabetes(0.7)).metrics.diabetes).toBeNull();
    expect(
      build(analysisWith({ cleanSeconds: 89.9, durationS: 89.9 }), withDiabetes(0.7)).metrics.diabetes,
    ).toBeNull();
  });
});
