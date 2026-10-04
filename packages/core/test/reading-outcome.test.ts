import {
  analyzeReading,
  cleanSeconds,
  DSP_CONFIG,
  readingOutcome,
  type ReadingAnalysis,
  type ReadingContext,
  type RejectedSpan,
} from '../src';
import { captureAt, regularOffsets } from './synthetic';

const CONTEXT: ReadingContext = {
  captureFps: 30,
  tier: 'basic',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};

// −R pulses at 72 bpm on a covered fingertip (R/(G+B) ≈ 4, so every frame passes DSP-4).
function fingertip(seconds: number) {
  return captureAt(regularOffsets(30, seconds), (tS) => {
    const phaseS = (tS - 0.5) % (60 / 72);
    return { r: 0.62 - 0.004 * Math.exp(-0.5 * (phaseS / 0.06) ** 2), g: 0.11, b: 0.04 };
  });
}

// What the Android emulator records with no finger and no torch: a dim, grey, unchanging scene.
function emptyRoom(seconds: number) {
  return captureAt(regularOffsets(30, seconds), () => ({ r: 0.08, g: 0.08, b: 0.07 }));
}

// A small real analysis whose timing fields the tests replace; readingOutcome reads only those.
const BASE = analyzeReading(fingertip(20), CONTEXT);

function analysisOf(
  mode: string,
  durationS: number,
  rejectedSpans: RejectedSpan[],
  heartRateBpm: number | null = 72,
): ReadingAnalysis {
  return {
    ...BASE,
    context: { ...CONTEXT, mode },
    durationS,
    rejectedSpans,
    cleanSeconds: cleanSeconds(0, durationS, rejectedSpans),
    heartRateBpm,
  };
}

const NEEDED = DSP_CONFIG.rules.modeMinCleanS;

describe('readingOutcome (spec 07: finish, extend, or end as inconclusive)', () => {
  it('the clean-seconds targets are the spec §12 Modes durations, and Deep HRV is SDNN’s 5 min', () => {
    expect(NEEDED).toEqual({ quick: 30, full: 90, deep: 300 });
  });

  it('the emulator case: no finger and no torch is inconclusive with 0 clean s, all lost to light', () => {
    const analysis = analyzeReading(emptyRoom(40), CONTEXT);
    const outcome = readingOutcome(analysis);
    expect(outcome).toEqual({
      kind: 'inconclusive',
      reasons: ['tooFewCleanSeconds', 'noHeartRate'],
      cleanSeconds: 0,
      neededCleanSeconds: 90,
      lostSeconds: { motion: 0, pressure: 0, coverage: analysis.durationS, coldHands: 0 },
      otherLostSeconds: 0,
      causes: ['coverage'],
    });
  });

  it('a clean fingertip capture past the target is a reading', () => {
    const analysis = analyzeReading(fingertip(32), { ...CONTEXT, mode: 'quick' });
    expect(analysis.cleanSeconds).toBeGreaterThanOrEqual(30);
    expect(analysis.heartRateBpm).not.toBeNull();
    expect(readingOutcome(analysis)).toEqual({ kind: 'reading' });
  });

  it.each(Object.entries(NEEDED))(
    '%s: at %i clean s it is a reading, just below it is not',
    (mode, needed) => {
      const atTarget = analysisOf(mode, needed + 10, [{ startS: 0, endS: 10, reason: 'motion' }]);
      expect(atTarget.cleanSeconds).toBe(needed);
      expect(readingOutcome(atTarget)).toEqual({ kind: 'reading' });

      const below = analysisOf(mode, needed + 10, [{ startS: 0, endS: 10.001, reason: 'motion' }]);
      const outcome = readingOutcome(below);
      expect(outcome.kind).toBe('inconclusive');
      if (outcome.kind !== 'inconclusive') return;
      expect(outcome.reasons).toEqual(['tooFewCleanSeconds']);
      expect(outcome.cleanSeconds).toBeCloseTo(needed - 0.001, 9);
      expect(outcome.neededCleanSeconds).toBe(needed);
    },
  );

  it('with enough clean seconds but no heart rate (DSP-11 found nothing to report) it is inconclusive', () => {
    const outcome = readingOutcome(analysisOf('quick', 40, [], null));
    expect(outcome).toMatchObject({ kind: 'inconclusive', reasons: ['noHeartRate'], cleanSeconds: 40 });
  });

  it('each lost second is counted once, under the first cause in §12 coaching order', () => {
    const spans: RejectedSpan[] = [
      { startS: 0, endS: 5, reason: 'coverage' },
      { startS: 3, endS: 8, reason: 'motion' }, // 3–5 is coverage's
      { startS: 10, endS: 12, reason: 'clipping' },
      { startS: 11, endS: 15, reason: 'coldHands' }, // 11–12 is pressure's
      { startS: 20, endS: 24, reason: 'quality' },
      { startS: 23, endS: 24.5, reason: 'exposure' },
    ];
    const outcome = readingOutcome(analysisOf('quick', 30, spans));
    if (outcome.kind !== 'inconclusive') throw new Error('expected inconclusive');
    expect(outcome.cleanSeconds).toBeCloseTo(12.5, 9);
    expect(outcome.lostSeconds.coverage).toBeCloseTo(5, 9);
    expect(outcome.lostSeconds.motion).toBeCloseTo(3, 9);
    expect(outcome.lostSeconds.pressure).toBeCloseTo(2, 9);
    expect(outcome.lostSeconds.coldHands).toBeCloseTo(3, 9);
    expect(outcome.otherLostSeconds).toBeCloseTo(4.5, 9);
    const { motion, pressure, coverage, coldHands } = outcome.lostSeconds;
    const total = outcome.cleanSeconds + motion + pressure + coverage + coldHands + outcome.otherLostSeconds;
    expect(total).toBeCloseTo(30, 9);
  });

  it('the reported pressure cause also takes a pressure span, and spans past the capture are clipped', () => {
    const outcome = readingOutcome(
      analysisOf('quick', 20, [
        { startS: -2, endS: 1, reason: 'pressure' },
        { startS: 18, endS: 25, reason: 'motion' },
      ]),
    );
    if (outcome.kind !== 'inconclusive') throw new Error('expected inconclusive');
    expect(outcome.lostSeconds).toEqual({ motion: 2, pressure: 1, coverage: 0, coldHands: 0 });
    expect(outcome.cleanSeconds).toBe(17);
  });

  it('causes run from most to least lost time, ties in §12 coaching order, causes with none left out', () => {
    const outcome = readingOutcome(
      analysisOf('quick', 30, [
        { startS: 0, endS: 2, reason: 'coverage' },
        { startS: 5, endS: 9, reason: 'clipping' },
        { startS: 10, endS: 14, reason: 'motion' },
        { startS: 20, endS: 26, reason: 'quality' },
      ]),
    );
    if (outcome.kind !== 'inconclusive') throw new Error('expected inconclusive');
    expect(outcome.causes).toEqual(['motion', 'pressure', 'coverage']);
  });

  it('time lost only to quality or exposure names no coaching cause', () => {
    const outcome = readingOutcome(analysisOf('quick', 30, [{ startS: 0, endS: 10, reason: 'quality' }]));
    expect(outcome).toMatchObject({ kind: 'inconclusive', causes: [], otherLostSeconds: 10 });
  });

  it('is pure: the same analysis gives the same outcome and is not changed', () => {
    const analysis = analysisOf('full', 60, [{ startS: 5, endS: 9, reason: 'motion' }]);
    const before = structuredClone(analysis.rejectedSpans);
    expect(readingOutcome(analysis)).toEqual(readingOutcome(analysis));
    expect(analysis.rejectedSpans).toEqual(before);
  });

  it('a mode with no clean-seconds target (the standing test) is a caller error', () => {
    expect(() => readingOutcome(analysisOf('standing', 60, []))).toThrow(RangeError);
  });
});
