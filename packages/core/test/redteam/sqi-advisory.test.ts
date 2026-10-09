import {
  analyzeReading,
  buildReadingResult,
  createLiveSession,
  DSP_CONFIG,
  emergencyHeartRate,
  readingOutcome,
  type ReadingAnalysis,
  type ReadingContext,
  type SqiScores,
} from '../../src';
import { captureAt, regularOffsets } from '../synthetic';
import { beatTimes, beatTrain, seededNormal } from './attacks';
import {
  BATTERY_CAPTURES,
  BATTERY_CONTEXTS,
  BATTERY_PROFILES,
  PASSED_EVIDENCE,
} from './lower-quality-battery';

// Red team (§16) for the owner's "Advisory + tag" decision (2026-10-06): on the Galaxy A17 the clean count
// stalled on a steady finger because SQI-Net v1 accepted about 64% of clean development windows and each veto
// cost 4 s. A window scored under the threshold must now never stop the clean count, live or saved, and the
// reading must always say how many windows were flagged.

const THRESHOLD = 0.5;
const SCORE_PATTERNS: [string, (k: number, normal: () => number) => number][] = [
  ['every window low', () => 0.1],
  ['every other window low', (k) => (k % 2 === 0 ? 0.2 : 0.9)],
  ['36% low at random', (_, normal) => (normal() < -0.36 ? 0.3 : 0.8)],
  ['just under the threshold', () => THRESHOLD - 1e-9],
  ['all at the threshold', () => THRESHOLD],
];

// One score a second for 4 s windows ending on the 64 Hz grid, as the app sends them.
function scoresFor(
  analysis: ReadingAnalysis,
  pattern: (k: number, normal: () => number) => number,
): SqiScores {
  const normal = seededNormal(11);
  const ends = Math.floor(analysis.durationS) - DSP_CONFIG.dsp3.modelWindowS + 1;
  const windows = Array.from({ length: Math.max(0, ends) }, (_, k) => ({
    endNs: analysis.startNs + (k + DSP_CONFIG.dsp3.modelWindowS) * 1e9,
    pClean: pattern(k, normal),
  }));
  return { threshold: THRESHOLD, windows };
}

describe('red team: advisory SQI-Net never stops the clean count and tags a mostly flagged reading', () => {
  const sqiContexts = BATTERY_CONTEXTS.filter(({ context }) => context.sqi !== null);
  it.each(BATTERY_CAPTURES.map((capture) => [capture.name, capture] as const))(
    '%s',
    (_, battery) => {
      const capture = battery.build();
      for (const { context } of sqiContexts) {
        const passing = analyzeReading(capture, context);
        for (const [, pattern] of SCORE_PATTERNS) {
          const sqi = scoresFor(passing, pattern);
          const scored = analyzeReading(capture, { ...context, sqi });
          const low = sqi.windows.filter((window) => window.pClean < THRESHOLD).length;
          // The count, the spans, the beats and SAFE-1 are those of a reading with every window passing.
          expect(scored.cleanSeconds).toBe(passing.cleanSeconds);
          expect(scored.rejectedSpans).toEqual(passing.rejectedSpans);
          expect(scored.heartRateBpm).toBe(passing.heartRateBpm);
          expect(readingOutcome(scored)).toEqual(readingOutcome(passing));
          expect(emergencyHeartRate(scored)).toEqual(emergencyHeartRate(passing));
          expect(scored.sqiFlagged).toEqual({ windows: low, total: sqi.windows.length });

          for (const { profile } of BATTERY_PROFILES) {
            const built = buildReadingResult(
              scored,
              { rhythm: null, diabetes: null },
              PASSED_EVIDENCE,
              profile,
              [],
            );
            // Owner 2026-10-09 ("make the standards for a good reading lower"): tagged only at or above the share.
            const tagged = low / sqi.windows.length >= DSP_CONFIG.dsp3.sqiFlaggedTagShare;
            const tag = built.quality.reasons.find((reason) => reason.kind === 'sqiFlagged');
            if (!tagged) expect(tag).toBeUndefined();
            else expect(tag).toEqual({ kind: 'sqiFlagged', windows: low, total: sqi.windows.length });
            if (built.metrics.hr) expect(built.metrics.hr.qualityReasons.includes('sqiFlagged')).toBe(tagged);
            // A flag the rules raise is never hidden by the tag.
            const plain = buildReadingResult(
              passing,
              { rhythm: null, diabetes: null },
              PASSED_EVIDENCE,
              profile,
              [],
            );
            expect(built.metrics.hr?.flag ?? null).toBe(plain.metrics.hr?.flag ?? null);
          }
        }
      }
    },
    120_000,
  );

  it('live: a low score at any time leaves the session count and the saved one equal to an unscored run', () => {
    const fps = 30;
    const capture = captureAt(regularOffsets(fps, 40), beatTrain(beatTimes([0.8], 40)));
    const play = (score: ((endS: number) => number) | null) => {
      const session = createLiveSession({
        captureFps: fps,
        sqiThreshold: THRESHOLD,
        perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
      });
      const counts: number[] = [];
      let scoredEndS: number | null = null;
      for (let start = 0; start < capture.samples.length; start += 3) {
        session.pushSamples({
          samples: capture.samples.slice(start, start + 3),
          stats: capture.stats.slice(start, start + 3),
        });
        session.pushStatus({ fingerCovered: true, motionRms: 0, thermal: 'nominal', fps, droppedFrac: 0 });
        const window = session.sqiWindow;
        if (score && window && window.endS !== scoredEndS) {
          scoredEndS = window.endS;
          session.setSqi(window.endS, score(window.endS));
        }
        counts.push(session.cleanSeconds);
      }
      const { capture: saved, ...spans } = session.readingInput();
      const context: ReadingContext = { ...BATTERY_CONTEXTS[0]!.context, captureFps: fps, ...spans };
      return { counts, analysis: analyzeReading(saved, context) };
    };
    const unscored = play(null);
    const vetoed = play(() => 0);
    expect(vetoed.counts).toEqual(unscored.counts);
    expect(vetoed.analysis.cleanSeconds).toBe(unscored.analysis.cleanSeconds);
    expect(vetoed.analysis.sqiFlagged!.windows).toBe(vetoed.analysis.sqiFlagged!.total);
    expect(vetoed.analysis.sqiFlagged!.total).toBeGreaterThan(30);
    expect(unscored.analysis.sqiFlagged).toBeNull();
  });
});
