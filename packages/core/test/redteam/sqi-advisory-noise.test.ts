import fs from 'fs';
import path from 'path';
import {
  analyzeReading,
  buildReadingResult,
  createLiveSession,
  DSP_CONFIG,
  emergencyHeartRate,
  logisticRhythmOutputs,
  rhythmModelRows,
  type ReadingAnalysis,
  type ReadingContext,
  type RhythmOutputs,
  type SqiScores,
} from '../../src';
import { captureAt, regularOffsets, type SyntheticCapture } from '../synthetic';
import { beatTimes, beatTrain, coveredNoise } from './attacks';
import noiseFixture from './fixtures/noise-rhythm-rows.json';
import { BATTERY_CONTEXTS, BATTERY_HISTORY, PASSED_EVIDENCE } from './lower-quality-battery';

// Red team (§16) for PR #299 at 79958b9: SQI-Net advisory (owner 2026-10-06, "Advisory + tag"), the retake prompt
// (ADR 0104 answer 2), and no rhythm class under 20 reading-wide intervals (answer 5). Owner 2026-10-09: "A
// fingertip held over pure noise showing a heart rate, should be tagged as low quality. it is acceptable."
// The noise is coveredNoise (no pulse at all); SQI-Net is a stand-in score, as the app's model is not in Jest.

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../../models/manifest.json'), 'utf8'),
);
const LOGISTIC = manifest.models.find((entry: { name: string }) => entry.name === 'rhythm-logistic');
const LGBM_TAU_AF = manifest.models.find((entry: { name: string }) => entry.name === 'rhythm-lgbm').threshold
  .af;
const NO_FLAGS = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };
const THRESHOLD = 0.5;
const FULL_30: ReadingContext = { ...BATTERY_CONTEXTS[0]!.context, captureFps: 30, tier: 'basic', sqi: null };

// Full Scan, 95 s at 30 fps of noise (seed 2, smoothing 0.8): one standard 32-interval rhythm window, 98.4 bpm.
const NOISE_SECONDS = 95;
const noiseCapture = () =>
  captureAt(regularOffsets(30, NOISE_SECONDS), coveredNoise(30, NOISE_SECONDS, 2, 0.006, 0.8));
// rhythm-lgbm's output on that one row (ml/tests/redteam/test_redteam_noise_rhythm.py checks it).
const lgbmOn = (analysis: ReadingAnalysis): RhythmOutputs => ({
  windowProbs: rhythmModelRows(analysis).map(() => [0.008, 0.869, 0.123]),
  tauAf: LGBM_TAU_AF,
  scorer: 'model',
});

// The app's loop (useLiveCapture): each new SQI-Net window is scored while scoreUntilS allows. After that,
// scoreSqiWindow throwing or returning a source other than 'model' is only logged, and the capture goes on.
function liveReading(capture: SyntheticCapture, scoreUntilS: number): ReadingAnalysis {
  const session = createLiveSession({
    captureFps: 30,
    sqiThreshold: THRESHOLD,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  let scoredEndS: number | null = null;
  for (let start = 0; start < capture.samples.length; start += 3) {
    session.pushSamples({
      samples: capture.samples.slice(start, start + 3),
      stats: capture.stats.slice(start, start + 3),
    });
    session.pushStatus({ fingerCovered: true, motionRms: 0, thermal: 'nominal', fps: 30, droppedFrac: 0 });
    const window = session.sqiWindow;
    if (window && window.endS !== scoredEndS && window.endS <= scoreUntilS) {
      scoredEndS = window.endS;
      session.setSqi(window.endS, 0.9);
    }
  }
  const { capture: saved, ...spans } = session.readingInput();
  return analyzeReading(saved, { ...FULL_30, ...spans });
}

// One SQI-Net score a second for 4 s windows, as the app sends them.
function sqiEverySecond(analysis: ReadingAnalysis, score: (k: number) => number): SqiScores {
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  const ends = Math.floor(analysis.durationS) - windowS + 1;
  return {
    threshold: THRESHOLD,
    windows: Array.from({ length: ends }, (_, k) => ({
      endNs: analysis.startNs + (k + windowS) * 1e9,
      pClean: score(k),
    })),
  };
}

describe('red team PR #299: noise SQI-Net stopped scoring', () => {
  const noise = liveReading(noiseCapture(), 10);

  it('setup: SQI-Net scored 7 clean windows in the first 10 s, then none, and the noise counts 95 clean s', () => {
    expect(noise.sqiAvailable).toBe(true);
    expect(noise.sqiFlagged).toEqual({ windows: 0, total: 7 });
    expect(noise.cleanSeconds).toBeGreaterThan(90);
    expect(noise.heartRateBpm).toBeCloseTo(98.4, 1);
    expect(noise.rhythmFeatures.length).toBe(1);
  });

  // Found by red team. Observed: 98.4 bpm, quality standard, confidence high; with rhythm-lgbm's own output and
  // one positive reading an hour before, headline "Possible AFib", rhythm quality standard, confidence high, and
  // the reading standard: no lower-quality tag anywhere. 85 of its 95 s were never scored, yet readingConfidence
  // treated sqiAvailable as the whole reading scored. Owner 2026-10-09: noise showing a rate is tagged.
  it('noise after SQI-Net stops scoring is tagged lower quality', () => {
    const built = buildReadingResult(
      noise,
      { rhythm: lgbmOn(noise), diabetes: null },
      PASSED_EVIDENCE,
      NO_FLAGS,
      BATTERY_HISTORY,
    );
    expect(built.metrics.hr!.quality).toBe('low');
    expect(built.metrics.rhythm!.confidence).not.toBe('high');
    expect(built.quality.level).toBe('low');
  });
});

describe('red team PR #299: noise when SQI-Net never ran', () => {
  // Found by red team. 79958b9 counted !sqiAvailable as the noise reading's tag, but noSqi reached only the
  // rhythm card's reasons (confidenceReasons), never the heart rate. Observed: 98.4 bpm, quality standard. Under
  // the owner's 2026-10-09 ruling every rate SQI-Net never scored is tagged, on any phone.
  it('noise with no SQI-Net scores tags the heart rate', () => {
    const analysis = analyzeReading(noiseCapture(), FULL_30);
    expect(analysis.heartRateBpm).toBeCloseTo(98.4, 1);
    const built = buildReadingResult(
      analysis,
      { rhythm: null, diabetes: null },
      PASSED_EVIDENCE,
      NO_FLAGS,
      [],
    );
    expect(built.metrics.hr!.qualityReasons).toContain('noSqi');
  });
});

describe('red team PR #299: rhythm flags from noise SQI-Net flagged everywhere', () => {
  const plain = analyzeReading(noiseCapture(), FULL_30);
  const flagged = analyzeReading(noiseCapture(), { ...FULL_30, sqi: sqiEverySecond(plain, () => 0.1) });

  it('setup: every one of the 91 windows is flagged and the noise still has a standard rhythm window', () => {
    expect(flagged.sqiFlagged).toEqual({ windows: 91, total: 91 });
    expect(flagged.rhythmFeatures.length).toBe(1);
  });

  // OWNER DECISION (ADR 0104 question 6 asked about noise's "flags"; the 2026-10-09 ruling covers the heart rate).
  // Observed: with the shipped rhythm-lgbm and with the app's rule fallback (rhythm-logistic, P(AF) 0.980), pure
  // noise flagged in all 91 windows reads "irregular", and with one positive an hour before "Possible AFib"
  // (confidence moderate for the model, low for the rule, tagged sqiFlagged). Before PR #299 SQI-Net rejected
  // these windows and the capture was inconclusive.
  test.failing.each([
    ['rhythm-lgbm', (analysis: ReadingAnalysis) => lgbmOn(analysis)],
    [
      'rhythm-logistic rule',
      (analysis: ReadingAnalysis): RhythmOutputs => ({
        ...logisticRhythmOutputs(LOGISTIC, rhythmModelRows(analysis)),
        scorer: 'rule',
      }),
    ],
  ])('%s: no rhythm flag on noise SQI-Net flagged everywhere', (_, outputs) => {
    const built = buildReadingResult(
      flagged,
      { rhythm: outputs(flagged), diabetes: null },
      PASSED_EVIDENCE,
      NO_FLAGS,
      BATTERY_HISTORY,
    );
    expect(built.metrics.rhythm!.flag).toBeNull();
  });
});

describe('red team PR #299: the retake prompt and SAFE-1', () => {
  const pulse = (bpm: number, seconds: number) =>
    captureAt(regularOffsets(30, seconds), beatTrain(beatTimes([60 / bpm], seconds + 5)));

  // Found by red team. A rate that meets every floor is tagged low by one SQI-flagged window (1 of 71 or 56), and
  // retakePrompt said the reading was short ('shortFast' / 'shortSlow') on a 75 s or 60 s reading while
  // emergencyHeartRate opens the Emergency screen on the same rate. Answer 2 is for a rate under 15 clean s, so the
  // prompt is only for a rate the standard analysis has none of.
  it.each([
    [170, 75],
    [35, 60],
  ])('%i bpm, %i s, one window flagged: no short-reading prompt beside SAFE-1', (bpm, seconds) => {
    const capture = pulse(bpm, seconds);
    const plain = analyzeReading(capture, FULL_30);
    const analysis = analyzeReading(capture, {
      ...FULL_30,
      sqi: sqiEverySecond(plain, (k) => (k === 0 ? 0.1 : 0.9)),
    });
    expect(analysis.heartRateBpm).not.toBeNull();
    expect(emergencyHeartRate(analysis)).not.toBeNull();
    const built = buildReadingResult(
      analysis,
      { rhythm: null, diabetes: null },
      PASSED_EVIDENCE,
      NO_FLAGS,
      [],
    );
    expect(built.retakePrompt).toBeNull();
  });

  // Holds. Motion over all but cleanS seconds: the rate comes only from the lower-quality path, which prompts a
  // retake and never reaches SAFE-1, flagged by SQI-Net or not.
  const cases = [170, 35].flatMap((bpm) =>
    [4, 8, 12, 14].flatMap((cleanS) => [0.1, 0.9, null].map((pClean) => [bpm, cleanS, pClean] as const)),
  );
  it.each(cases)('%i bpm, %i clean s, SQI %p: retake prompt, no Emergency', (bpm, cleanS, pClean) => {
    const seconds = 75;
    const capture = pulse(bpm, seconds);
    const firstNs = capture.samples[0]!.tNs;
    const keepFromS = 30;
    const motionSpans = [
      { startNs: firstNs, endNs: firstNs + keepFromS * 1e9 },
      { startNs: firstNs + (keepFromS + cleanS) * 1e9, endNs: firstNs + (seconds + 1) * 1e9 },
    ];
    const plain = analyzeReading(capture, { ...FULL_30, motionSpans });
    const sqi = pClean === null ? null : sqiEverySecond(plain, () => pClean);
    const analysis = analyzeReading(capture, { ...FULL_30, motionSpans, sqi });
    expect(analysis.heartRateBpm).toBeNull();
    expect(emergencyHeartRate(analysis)).toBeNull();
    const built = buildReadingResult(
      analysis,
      { rhythm: null, diabetes: null },
      PASSED_EVIDENCE,
      NO_FLAGS,
      [],
    );
    if (built.metrics.hr === null) return;
    expect(built.metrics.hr.quality).toBe('low');
    expect(built.retakePrompt).toBe(bpm > 150 ? 'shortFast' : 'shortSlow');
  });
});

describe('red team PR #299: the noise rhythm rows, and no class under 20 intervals', () => {
  const certainAf: [number, number, number] = [0.01, 0.98, 0.01];
  it.each(noiseFixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const capture = captureAt(
      regularOffsets(entry.fps, entry.seconds),
      coveredNoise(entry.fps, entry.seconds, entry.seed, 0.006, entry.smoothing),
    );
    const context: ReadingContext = {
      ...FULL_30,
      mode: entry.mode,
      captureFps: entry.fps,
      tier: entry.fps >= 60 ? 'full' : 'basic',
    };
    const analysis = analyzeReading(capture, context);
    expect(analysis.rhythmFeatures.length).toBe(entry.standardRows);
    expect(analysis.lowQuality.rhythmWindow?.intervalsS.length ?? null).toBe(entry.windowIntervals);
    const rows = rhythmModelRows(analysis);
    expect(rows.length).toBe(entry.rows.length);
    rows.forEach((row, r) => row.forEach((value, f) => expect(value).toBeCloseTo(entry.rows[r]![f]!, 12)));

    // A window too short to judge gives no class or flag even when the model is certain of AF.
    if (entry.standardRows > 0 || entry.windowIntervals === null || entry.windowIntervals >= 20) return;
    const flaggedEverywhere = analyzeReading(capture, {
      ...context,
      sqi: sqiEverySecond(analysis, () => 0.1),
    });
    const built = buildReadingResult(
      flaggedEverywhere,
      { rhythm: { windowProbs: rows.map(() => certainAf), tauAf: LGBM_TAU_AF }, diabetes: null },
      PASSED_EVIDENCE,
      NO_FLAGS,
      BATTERY_HISTORY,
    );
    expect(built.metrics.rhythm).toMatchObject({ class: null, pAF: null, flag: null });
    expect(built.headlineKey).toBe(built.metrics.hr ? 'result.hrOnly' : 'result.inconclusive');
  });
});
