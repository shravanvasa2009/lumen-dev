import fs from 'fs';
import path from 'path';
import {
  analyzeReading,
  buildReadingResult,
  createLiveSession,
  DSP_CONFIG,
  emergencyHeartRate,
  rhythmModelRows,
  type ReadingAnalysis,
  type ReadingContext,
  type RhythmOutputs,
  type SqiScores,
} from '../../src';
import { captureAt, regularOffsets } from '../synthetic';
import { beatTimes, beatTrain, coveredNoise } from './attacks';
import { BATTERY_CONTEXTS, BATTERY_HISTORY, PASSED_EVIDENCE } from './lower-quality-battery';

// Red team (§16) for PR #308 at 73e1a7e: sqiFlagged now tags a reading only when the flagged share of its scored
// windows reaches dsp3.sqiFlaggedTagShare (0.5, pending the owner's check of the number), and a mostly flagged
// reading keeps its rhythm class and flag (owner 2026-10-09, ADR 0104 answers a and b). SQI-Net is a stand-in
// score, as the app's model is not in Jest. Python has no reading-result code, so the share has no Python twin.

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../../models/manifest.json'), 'utf8'),
);
const LGBM_TAU_AF = manifest.models.find((entry: { name: string }) => entry.name === 'rhythm-lgbm').threshold
  .af;
const NO_FLAGS = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };
const THRESHOLD = 0.5;
const FULL_30: ReadingContext = { ...BATTERY_CONTEXTS[0]!.context, captureFps: 30, tier: 'basic', sqi: null };
const SECONDS = 95;

// Full Scan, 95 s at 30 fps of covered-lens noise (seed 2, smoothing 0.8), the capture of sqi-advisory-noise.
const noiseCapture = () => captureAt(regularOffsets(30, SECONDS), coveredNoise(30, SECONDS, 2, 0.006, 0.8));
// rhythm-lgbm's output on that capture's one row (ml/tests/redteam/test_redteam_noise_rhythm.py checks it).
const lgbmOn = (analysis: ReadingAnalysis): RhythmOutputs => ({
  windowProbs: rhythmModelRows(analysis).map(() => [0.008, 0.869, 0.123]),
  tauAf: LGBM_TAU_AF,
  scorer: 'model',
});

// `count` SQI-Net scores, one a second for 4 s windows from the start, as the app sends them.
function sqiScores(startNs: number, count: number, flagged: (k: number) => boolean): SqiScores {
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  return {
    threshold: THRESHOLD,
    windows: Array.from({ length: count }, (_, k) => ({
      endNs: startNs + (k + windowS) * 1e9,
      pClean: flagged(k) ? 0.1 : 0.9,
    })),
  };
}

function built(analysis: ReadingAnalysis) {
  return buildReadingResult(
    analysis,
    { rhythm: lgbmOn(analysis), diabetes: null },
    PASSED_EVIDENCE,
    NO_FLAGS,
    BATTERY_HISTORY,
  );
}

describe('red team PR #308: a reading SQI-Net flagged in exactly half its windows', () => {
  const startNs = analyzeReading(noiseCapture(), FULL_30).startNs;
  // 90 scores (ends 4 to 93 s) leave under 2 s unscored, inside dsp3.sqiUnscoredMaxS.
  const half = analyzeReading(noiseCapture(), {
    ...FULL_30,
    sqi: sqiScores(startNs, 90, (k) => k % 2 === 0),
  });
  const overHalf = analyzeReading(noiseCapture(), {
    ...FULL_30,
    sqi: sqiScores(startNs, 91, (k) => k % 2 === 0),
  });

  it('setup: 45 of 90 and 46 of 91 flagged, both scored to within the 4 s allowance', () => {
    expect(half.sqiFlagged).toEqual({ windows: 45, total: 90 });
    expect(overHalf.sqiFlagged).toEqual({ windows: 46, total: 91 });
    expect(half.sqiUnscoredS!).toBeLessThanOrEqual(DSP_CONFIG.dsp3.sqiUnscoredMaxS);
    expect(half.heartRateBpm).toBeCloseTo(98.4, 1);
  });

  it('46 of 91 (over the share): the Possible AFib call shows, tagged sqiFlagged, below high confidence', () => {
    const rhythm = built(overHalf).metrics.rhythm!;
    expect(rhythm.flag).toBe('possibleAf');
    expect(rhythm.qualityReasons).toContain('sqiFlagged');
    expect(rhythm.confidence).not.toBe('high');
  });

  // Found by red team on PR #308. Pure covered-lens noise, SQI-Net flagging every other 4 s window (45 of 90, a
  // share of exactly 0.5), rhythm-lgbm's own output on the noise row (P(AF) 0.869), one positive reading an hour
  // before. Observed: heart rate 98.4 bpm standard, high; rhythm "possibleAf", quality standard, confidence high;
  // reading quality standard, no reason anywhere. One more flagged window (46 of 91) gives the tagged, moderate
  // card. Before this PR any flagged window capped confidence at moderate and tagged every metric. Fixed: the main
  // session made the share inclusive (">=") pending the owner (ADR 0104 answer b); an owner ruling that half
  // flagged is acceptable retires this test.
  it('45 of 90 flagged noise never shows a standard, high-confidence Possible AFib', () => {
    const reading = built(half);
    expect(reading.metrics.rhythm!.flag).toBe('possibleAf');
    expect(reading.metrics.rhythm!.confidence).not.toBe('high');
    expect(reading.quality.level).toBe('low');
  });

  it('SAFE-1 is untouched: the emergency rule gives the same answer at 45 of 90 as with no SQI-Net', () => {
    const plain = analyzeReading(noiseCapture(), FULL_30);
    expect(emergencyHeartRate(half)).toEqual(emergencyHeartRate(plain));
    expect(emergencyHeartRate(overHalf)).toEqual(emergencyHeartRate(plain));
  });
});

describe('red team PR #308: half a reading on the pulse, half on noise', () => {
  // 70 bpm beats for the first 47.5 s, then covered-lens noise; SQI-Net flags the noise half (45 of 90).
  const pulse = beatTrain(beatTimes([60 / 70], SECONDS));
  const noise = coveredNoise(30, SECONDS, 2, 0.006, 0.8);
  const capture = () =>
    captureAt(regularOffsets(30, SECONDS), (tS) => (tS < SECONDS / 2 ? pulse(tS) : noise(tS)));
  const startNs = analyzeReading(capture(), FULL_30).startNs;
  const mixed = analyzeReading(capture(), { ...FULL_30, sqi: sqiScores(startNs, 90, (k) => k >= 45) });

  // Found by red team on PR #308. Observed: 45 of 90 flagged, 94.97 of 94.97 s clean, heart rate 70.0 bpm,
  // quality standard, confidence high, reading quality standard with no reason, though 47.5 s of it is noise.
  // Fixed with the inclusive share; same pending-owner status as the 45 of 90 noise test above.
  it('a reading half noise by SQI-Net is not presented as standard quality', () => {
    expect(mixed.sqiFlagged).toEqual({ windows: 45, total: 90 });
    const reading = buildReadingResult(
      mixed,
      { rhythm: null, diabetes: null },
      PASSED_EVIDENCE,
      NO_FLAGS,
      BATTERY_HISTORY,
    );
    expect(reading.metrics.hr!.confidence).not.toBe('high');
    expect(reading.quality.level).toBe('low');
  });
});

describe('red team PR #308: the share counts each SQI-Net window once', () => {
  // Found by red team on PR #308. The share's denominator is the raw score count, and neither setSqi nor
  // analyzeReading refuses a second score for the same window. Observed: noise with all 91 windows flagged, each
  // window scored again at P(clean) 0.9, counts 91 of 182 (0.5), so the noise rate is standard and high and the
  // Possible AFib card standard and high. Under the old any-window rule a duplicate changed nothing. Fixed: each
  // window counts once, by its first score, in analyzeReading and in LiveSession.setSqi.
  it('a second score for a window SQI-Net already flagged does not dilute the share (analyzeReading)', () => {
    const startNs = analyzeReading(noiseCapture(), FULL_30).startNs;
    const once = sqiScores(startNs, 91, () => true);
    const twice: SqiScores = {
      threshold: THRESHOLD,
      windows: [...once.windows, ...once.windows.map((window) => ({ ...window, pClean: 0.9 }))],
    };
    const analysis = analyzeReading(noiseCapture(), { ...FULL_30, sqi: twice });
    expect(analysis.sqiFlagged).toEqual({ windows: 91, total: 91 });
    expect(built(analysis).metrics.rhythm!.qualityReasons).toContain('sqiFlagged');
  });

  it('a second score for the same window is ignored (LiveSession.setSqi)', () => {
    const session = createLiveSession({
      captureFps: 30,
      sqiThreshold: THRESHOLD,
      perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
    });
    const capture = noiseCapture();
    session.pushSamples({ samples: capture.samples.slice(0, 300), stats: capture.stats.slice(0, 300) });
    session.setSqi(8, 0.1);
    session.setSqi(8, 0.9);
    const { sqi } = session.readingInput();
    expect(sqi!.windows).toEqual([expect.objectContaining({ pClean: 0.1 })]);
  });
});

describe('red team PR #308 at c420d64: variants near the fixed share', () => {
  const startNs = analyzeReading(noiseCapture(), FULL_30).startNs;
  const scoredNoise = (sqi: SqiScores) => analyzeReading(noiseCapture(), { ...FULL_30, sqi });

  it('1 of 2 flagged reaches the share and tags the reading', () => {
    const analysis = scoredNoise(sqiScores(startNs, 2, (k) => k === 0));
    expect(analysis.sqiFlagged).toEqual({ windows: 1, total: 2 });
    expect(built(analysis).quality.reasons).toContainEqual({ kind: 'sqiFlagged', windows: 1, total: 2 });
  });

  it('44 of 89 (just under half) stays untagged by sqiFlagged', () => {
    const analysis = scoredNoise(sqiScores(startNs, 89, (k) => k % 2 === 1));
    expect(analysis.sqiFlagged).toEqual({ windows: 44, total: 89 });
    expect(built(analysis).quality.reasons.some((reason) => reason.kind === 'sqiFlagged')).toBe(false);
  });

  it('duplicates in reverse order: each window still counts once', () => {
    const once = sqiScores(startNs, 91, () => true);
    const analysis = scoredNoise({
      threshold: THRESHOLD,
      windows: [...once.windows, ...once.windows].reverse(),
    });
    expect(analysis.sqiFlagged).toEqual({ windows: 91, total: 91 });
  });

  // Found by red team on PR #308 at c420d64. "First score wins" depends on the order the scores arrive in. Observed:
  // noise with every window flagged (P(clean) 0.1), but a clean 0.9 score for each window listed first, counts 0 of
  // 91 flagged; the same scores in the other order count 91 of 91. A window any score flagged should count as
  // flagged, whatever the order, so a reading cannot be made standard by the order of its scores.
  it.failing('a clean score arriving before a flagged one for the same window does not hide the flag', () => {
    const flaggedScores = sqiScores(startNs, 91, () => true);
    const cleanFirst: SqiScores = {
      threshold: THRESHOLD,
      windows: [
        ...flaggedScores.windows.map((window) => ({ ...window, pClean: 0.9 })),
        ...flaggedScores.windows,
      ],
    };
    expect(scoredNoise(cleanFirst).sqiFlagged).toEqual({ windows: 91, total: 91 });
  });

  // Found by red team on PR #308 at c420d64. Observed: 91 flagged windows inside the 95 s reading plus 91 clean
  // windows that end after it (96 to 186 s) count 91 of 182, so the noise reading is untagged. LiveSession.setSqi
  // refuses a window outside the reading; analyzeReading counts it.
  it.failing('scores for windows outside the reading do not dilute the share (analyzeReading)', () => {
    const inside = sqiScores(startNs, 91, () => true);
    const after = Array.from({ length: 91 }, (_, k) => ({ endNs: startNs + (96 + k) * 1e9, pClean: 0.9 }));
    const outcome = (() => {
      try {
        return scoredNoise({ threshold: THRESHOLD, windows: [...inside.windows, ...after] }).sqiFlagged;
      } catch (error) {
        if (error instanceof RangeError) return 'RangeError';
        throw error;
      }
    })();
    if (outcome !== 'RangeError') expect(outcome).toEqual({ windows: 91, total: 91 });
  });
});
