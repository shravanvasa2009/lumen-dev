import {
  analyzeReading,
  cleanSeconds,
  DSP_CONFIG,
  readingOutcome,
  type InconclusiveOutcome,
  type NsSpan,
  type ReadingAnalysis,
  type ReadingContext,
  type ReadingOutcome,
  type RejectedSpan,
  type RejectionReason,
} from '../../src';
import { captureAt, parkMillerUniforms, regularOffsets, type SyntheticCapture } from '../synthetic';
import { seededNormal, type Channels } from './attacks';

// Red team for PR #171 (ADR 0072, spec 07 "a reading can never finish on bad data"). The invariants: a
// capture is a reading only with its mode's clean seconds and a heart rate; readingOutcome never throws on
// an analysis analyzeReading can produce (only on a mode with no target); and an inconclusive outcome's
// clean, lost, and other-lost seconds add up to the capture's length.

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

const NEEDED = DSP_CONFIG.rules.modeMinCleanS;
const MODES = Object.keys(NEEDED);
const SUM_TOLERANCE_S = 1e-9;

// 75 bpm with a dicrotic wave at 0.3 of the systolic one (double-detection bait), on a covered
// fingertip. Periodic, so a 300 s, 240 fps capture costs one evaluation per frame.
const RR_S = 0.8;
const gaussian = (x: number, centre: number, width: number) => Math.exp(-0.5 * ((x - centre) / width) ** 2);
const pulse: Channels = (tS) => {
  const phaseS = (((tS + 2) % RR_S) + RR_S) % RR_S;
  const volume = gaussian(phaseS, 0.12, 0.07) + 0.3 * gaussian(phaseS, 0.4, 0.07);
  return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
};
// The Android emulator with no finger and no torch: dim, grey, unchanging.
const emptyRoom: Channels = () => ({ r: 0.08, g: 0.08, b: 0.07 });

const offsetsUpTo = (fps: number, lastS: number) =>
  Array.from({ length: Math.round(lastS * fps) + 1 }, (_, k) => k / fps);
const nsSpan = (capture: SyntheticCapture, fromS: number, toS: number): NsSpan => ({
  startNs: capture.samples[0]!.tNs + fromS * 1e9,
  endNs: capture.samples[0]!.tNs + toS * 1e9,
});

function lostTotal(outcome: InconclusiveOutcome): number {
  const { motion, pressure, coverage, coldHands } = outcome.lostSeconds;
  return outcome.cleanSeconds + motion + pressure + coverage + coldHands + outcome.otherLostSeconds;
}

// What every outcome must satisfy, whatever the capture. ADR 0104 (owner, 2026-10-05): any heart rate,
// standard or lower quality, makes a reading; the mode target only tags it.
function expectSound(analysis: ReadingAnalysis, outcome: ReadingOutcome): void {
  if (analysis.heartRateBpm !== null)
    expect(analysis.cleanSeconds).toBeGreaterThanOrEqual(DSP_CONFIG.dsp11.minCleanS);
  const anyRate = analysis.heartRateBpm ?? analysis.lowQuality.heartRateBpm;
  if (outcome.kind === 'reading') {
    expect(anyRate).not.toBeNull();
    return;
  }
  expect(anyRate).toBeNull();
  expect(Math.abs(lostTotal(outcome) - analysis.durationS)).toBeLessThan(SUM_TOLERANCE_S);
  for (const seconds of [...Object.values(outcome.lostSeconds), outcome.otherLostSeconds])
    expect(seconds).toBeGreaterThanOrEqual(0);
  // Coverage is first in the coaching order, so it keeps every second it covers.
  expect(outcome.lostSeconds.coverage).toBeCloseTo(analysis.lostSeconds.coverage, 9);
  for (const cause of ['motion', 'coldHands'] as const)
    expect(outcome.lostSeconds[cause]).toBeLessThanOrEqual(analysis.lostSeconds[cause] + SUM_TOLERANCE_S);
}

function judge(capture: SyntheticCapture, context: Partial<ReadingContext> = {}) {
  const analysis = analyzeReading(capture, { ...CONTEXT, ...context });
  const outcome = readingOutcome(analysis);
  expectSound(analysis, outcome);
  return { analysis, outcome };
}

function inconclusive(outcome: ReadingOutcome): InconclusiveOutcome {
  if (outcome.kind !== 'inconclusive') throw new Error('expected an inconclusive outcome');
  return outcome;
}

// A real analysis whose timing fields a test replaces; readingOutcome reads only those and the mode. The
// per-cause lostSeconds are counted as analyzeReading counts them, and the HR is dropped under DSP-11's
// 15 s, so expectSound holds the stand-in to what analyzeReading could produce.
const BASE = analyzeReading(captureAt(regularOffsets(30, 20), pulse), CONTEXT);
function analysisOf(
  mode: string,
  durationS: number,
  rejectedSpans: RejectedSpan[],
  heartRateBpm: number | null = 75,
): ReadingAnalysis {
  const clean = cleanSeconds(0, durationS, rejectedSpans);
  const lost = (reason: RejectionReason) =>
    durationS -
    cleanSeconds(
      0,
      durationS,
      rejectedSpans.filter((span) => span.reason === reason),
    );
  return {
    ...BASE,
    context: { ...CONTEXT, mode },
    durationS,
    rejectedSpans,
    cleanSeconds: clean,
    lostSeconds: {
      motion: lost('motion'),
      pressure: lost('clipping'),
      coverage: lost('coverage'),
      coldHands: lost('coldHands'),
    },
    heartRateBpm: clean >= DSP_CONFIG.dsp11.minCleanS ? heartRateBpm : null,
    // The averaged beat's typed arrays can be neither frozen nor structuredClone'd into Jest's realm; readingOutcome
    // never reads it.
    lowQuality: {
      ...BASE.lowQuality,
      heartRateBpm: clean >= DSP_CONFIG.dsp11.minCleanS ? null : heartRateBpm,
      pulseShape: null,
    },
  };
}

// The same capture with no rate at all, so its lost time is attributed (an inconclusive outcome).
const withoutRate = (analysis: ReadingAnalysis): ReadingAnalysis => ({
  ...analysis,
  heartRateBpm: null,
  lowQuality: { ...analysis.lowQuality, heartRateBpm: null },
});

describe('red team: readingOutcome on captures analyzeReading made (spec 07)', () => {
  it.each(MODES.flatMap((mode) => [30, 60, 240].map((fps) => [mode, fps] as const)))(
    'no finger, no torch (the emulator), %s at %i fps: inconclusive, every second lost to light',
    (mode, fps) => {
      const { analysis, outcome } = judge(captureAt(regularOffsets(fps, 40), emptyRoom), {
        mode,
        captureFps: fps,
      });
      expect(outcome).toEqual({
        kind: 'inconclusive',
        reasons: ['tooFewCleanSeconds', 'noHeartRate'],
        cleanSeconds: 0,
        neededCleanSeconds: NEEDED[mode as keyof typeof NEEDED],
        lostSeconds: { motion: 0, pressure: 0, coverage: analysis.durationS, coldHands: 0 },
        otherLostSeconds: 0,
        causes: ['coverage'],
        urgent: null,
      });
    },
  );

  it('a black frame stream (lens covered, torch off) is inconclusive on coverage', () => {
    const { outcome } = judge(captureAt(regularOffsets(30, 100), () => ({ r: 0, g: 0, b: 0 })));
    expect(inconclusive(outcome)).toMatchObject({ cleanSeconds: 0, causes: ['coverage'] });
  });

  it('a finger lifted at 30.5 s of 60 s: a reading in both modes, its lost time on light (ADR 0104)', () => {
    const lifted: Channels = (tS) => (tS < 30.5 ? pulse(tS) : emptyRoom(tS));
    const capture = captureAt(regularOffsets(30, 60), lifted);
    expect(judge(capture, { mode: 'quick' }).outcome).toEqual({ kind: 'reading', urgent: null });
    const judged = judge(capture, { mode: 'full' });
    expect(judged.outcome).toEqual({ kind: 'reading', urgent: null });
    const full = inconclusive(readingOutcome(withoutRate(judged.analysis)));
    expect(full.reasons).toEqual(['tooFewCleanSeconds', 'noHeartRate']);
    expect(full.cleanSeconds).toBeCloseTo(30.5, 6);
    expect(full.causes).toEqual(['coverage']);
  });

  it.each([
    [16, 'standard'],
    [14, 'lower-quality'],
  ])('a finger on for only %i s of 100 s: a reading on the %s DSP-11 rate (ADR 0104)', (onS, kind) => {
    const lifted: Channels = (tS) => (tS < onS ? pulse(tS) : emptyRoom(tS));
    const { analysis, outcome } = judge(captureAt(regularOffsets(30, 100), lifted), { mode: 'quick' });
    expect(analysis.cleanSeconds).toBeCloseTo(onS, 6);
    expect(outcome.kind).toBe('reading');
    expect(analysis.heartRateBpm === null).toBe(kind === 'lower-quality');
    expect(Math.abs((analysis.heartRateBpm ?? analysis.lowQuality.heartRateBpm)! - 75)).toBeLessThan(1);
  });

  it('a pulse with 3 s motion bursts every 10 s: Quick (45 s) and Full (100 s) are readings', () => {
    const bursts = (capture: SyntheticCapture, seconds: number) =>
      Array.from({ length: Math.floor(seconds / 10) }, (_, k) => nsSpan(capture, 10 * k + 5, 10 * k + 8));
    // The accelerometer saw the motion, and the red channel jumped with it.
    const shaken: Channels = (tS) => {
      const frame = pulse(tS);
      return tS % 10 >= 5 && tS % 10 < 8 ? { ...frame, r: frame.r + 0.05 * Math.sin(9 * tS) } : frame;
    };
    const quick = captureAt(regularOffsets(30, 45), shaken);
    expect(judge(quick, { mode: 'quick', motionSpans: bursts(quick, 45) }).outcome).toEqual({
      kind: 'reading',
      urgent: null,
    });
    const full = captureAt(regularOffsets(30, 100), shaken);
    const judged = judge(full, { mode: 'full', motionSpans: bursts(full, 100) });
    expect(judged.outcome.kind).toBe('reading');
    const outcome = inconclusive(readingOutcome(withoutRate(judged.analysis)));
    expect(outcome.lostSeconds.motion).toBeCloseTo(30, 6);
    expect(outcome.causes).toEqual(['motion']);
  });

  it('pressing too hard (clipFrac 0.5 on every frame) is inconclusive on pressure', () => {
    const capture = captureAt(regularOffsets(30, 100), pulse);
    capture.stats.forEach((stat) => (stat.clipFrac = 0.5));
    const outcome = inconclusive(judge(capture).outcome);
    expect(outcome.cleanSeconds).toBe(0);
    expect(outcome.causes).toEqual(['pressure']);
  });

  it('cold hands paused the whole reading: inconclusive on cold hands', () => {
    const capture = captureAt(regularOffsets(30, 100), pulse);
    const outcome = inconclusive(judge(capture, { coldHandsSpans: [nsSpan(capture, 0, 100)] }).outcome);
    expect(outcome.cleanSeconds).toBe(0);
    expect(outcome.causes).toEqual(['coldHands']);
  });

  it('auto-exposure hunting (a change every 0.5 s) leaves almost nothing clean and names no cause', () => {
    const capture = captureAt(regularOffsets(30, 100), pulse);
    capture.stats.forEach((stat, i) => (stat.exposureNs = 8e6 + (Math.floor(i / 15) % 2) * 1e5));
    const outcome = inconclusive(judge(capture).outcome);
    expect(outcome.cleanSeconds).toBeLessThan(1);
    expect(outcome.causes).toEqual([]);
  });

  it('a flat line at full coverage (a pressed-flat pulse) has no HR and no clean seconds', () => {
    const { outcome } = judge(captureAt(regularOffsets(30, 100), () => ({ r: 0.6, g: 0.1, b: 0.05 })));
    expect(inconclusive(outcome)).toMatchObject({
      reasons: ['tooFewCleanSeconds', 'noHeartRate'],
      causes: [],
    });
  });

  it('white noise at full coverage that SQI-Net scores unclean is inconclusive', () => {
    const noise = seededNormal(7);
    const capture = captureAt(regularOffsets(30, 100), () => ({ r: 0.6 + 0.003 * noise(), g: 0.1, b: 0.05 }));
    const windows = Array.from({ length: 97 }, (_, k) => ({
      endNs: nsSpan(capture, 0, k + 4).endNs,
      pClean: 0.1,
    }));
    const { outcome } = judge(capture, { sqi: { threshold: 0.5, windows } });
    expect(inconclusive(outcome).cleanSeconds).toBe(0);
  });

  it('every rejection type at once, overlapping: one count per second, coverage first', () => {
    const lifted: Channels = (tS) => (tS >= 5 && tS < 10 ? emptyRoom(tS) : pulse(tS));
    const capture = captureAt(regularOffsets(30, 60), lifted);
    capture.stats.forEach((stat, i) => {
      if (i >= 20 * 30 && i < 25 * 30) stat.clipFrac = 0.5;
      if (i >= 45 * 30) stat.exposureNs = 9e6;
    });
    const { analysis, outcome } = judge(capture, {
      motionSpans: [nsSpan(capture, 8, 16)],
      coldHandsSpans: [nsSpan(capture, 23, 30)],
      sqi: { threshold: 0.5, windows: [{ endNs: nsSpan(capture, 0, 40).endNs, pClean: 0.1 }] },
    });
    expect(outcome.kind).toBe('reading');
    const lost = inconclusive(readingOutcome(withoutRate(analysis)));
    expect(lost.lostSeconds.motion).toBeCloseTo(analysis.lostSeconds.motion - 2, 6); // 8–10 s is coverage's
    expect(lost.lostSeconds.coldHands).toBeCloseTo(analysis.lostSeconds.coldHands - 2, 6); // 23–25 s is pressure's
    expect(lost.causes.slice(0, 2)).toEqual(['motion', 'coverage']);
    expect(lost.otherLostSeconds).toBeGreaterThan(4); // the SQI window and the exposure second
  });
});

describe('red team: Quick, Full, and Deep at their targets, at 30, 60, and 240 fps', () => {
  const cases = MODES.flatMap((mode) =>
    (mode === 'deep' ? [30] : [30, 60, 240]).map(
      (fps) => [mode, fps, NEEDED[mode as keyof typeof NEEDED]] as const,
    ),
  );

  it.each(cases)(
    '%s at %i fps: exactly %i s of frames is a reading, and one frame less is too (ADR 0104)',
    (mode, fps, needed) => {
      const offsets = offsetsUpTo(fps, needed);
      const atTarget = judge(captureAt(offsets, pulse), { mode, captureFps: fps });
      expect(atTarget.analysis.cleanSeconds).toBe(needed);
      expect(atTarget.outcome).toEqual({ kind: 'reading', urgent: null });
      const short = judge(captureAt(offsets.slice(0, -1), pulse), { mode, captureFps: fps });
      expect(short.analysis.cleanSeconds).toBeLessThan(needed);
      expect(short.outcome).toEqual({ kind: 'reading', urgent: null });
    },
    120_000,
  );
});

describe('red team: frame gaps are not clean seconds (spec 07: the countdown advances only on clean seconds)', () => {
  // FAILS on 9dbbb5d. cleanSeconds counts the time between any two frames that pass DSP-4 as clean, so a
  // stretch with no frames at all (camera interrupted, app backgrounded, frames dropped) adds to the count
  // as if it were signal. DSP-2 splits segments at gaps > 150 ms, so no beat is found there, but the HR
  // from the frames either side is enough. Observed: { kind: 'reading' } with cleanSeconds ≈ the capture's
  // length. Expected: time inside a DSP-2 gap is not clean, so each capture below is inconclusive with
  // tooFewCleanSeconds. LiveSession counts clean seconds with the same function, so its ring jumps too.
  it.each([
    ['full', '20 s of pulse, no frames from 20 s to 95 s, then 1 s', 96, (tS: number) => tS < 20 || tS >= 95],
    [
      'quick',
      '16 s of pulse, no frames from 16 s to 30 s, then 1 s',
      31,
      (tS: number) => tS < 16 || tS >= 30,
    ],
    [
      'full',
      '20 s at 30 fps, then 75 s at 5 fps (every interval a 200 ms gap)',
      95,
      (tS: number) => tS < 20 || Math.round(tS * 30) % 6 === 0,
    ],
  ])(
    '%s: %s counts no gap as clean, and is a reading on the frames it has (ADR 0104)',
    (mode, _, seconds, kept) => {
      const analysis = analyzeReading(captureAt(regularOffsets(30, seconds).filter(kept), pulse), {
        ...CONTEXT,
        mode,
      });
      expect(analysis.cleanSeconds).toBeLessThan(NEEDED[mode as keyof typeof NEEDED]);
      expect(readingOutcome(analysis).kind).toBe('reading');
      expect(readingOutcome(withoutRate(analysis))).toMatchObject({
        kind: 'inconclusive',
        reasons: ['tooFewCleanSeconds', 'noHeartRate'],
      });
    },
  );

  it('two frames 100 s apart are inconclusive (held only by noHeartRate today)', () => {
    const outcome = inconclusive(judge(captureAt([0, 100], pulse)).outcome);
    expect(outcome.reasons).toContain('noHeartRate');
  });
});

describe('red team: the clean-seconds target under float error', () => {
  it('at exactly the target with no spans, the count is exact and the capture is a reading', () => {
    const { analysis, outcome } = judge(captureAt(offsetsUpTo(30, 30), pulse), { mode: 'quick' });
    expect(analysis.cleanSeconds).toBe(30);
    expect(outcome).toEqual({ kind: 'reading', urgent: null });
  });

  // Frame times 16.066666651 s to 16.766666651 s (whole ns) under motion, in a capture whose last frame is
  // at 30.7 s: 30 s clean to the ns, computed as 30 − 1 ulp. The error goes toward refusing, and the live
  // counter computes the same number from the same spans, so its ring had not completed either.
  it('a true 30 s clean count computed as 29.999999999999996, as the live count agrees, is a reading', () => {
    const capture = captureAt([...regularOffsets(30, 30.7), 30.7], pulse);
    const startNs = capture.samples[0]!.tNs;
    const { analysis, outcome } = judge(capture, {
      mode: 'quick',
      motionSpans: [{ startNs: startNs + 16_066_666_651, endNs: startNs + 16_766_666_651 }],
    });
    expect(analysis.cleanSeconds).toBe(29.999999999999996);
    expect(analysis.cleanSeconds).toBe(cleanSeconds(0, analysis.durationS, analysis.rejectedSpans));
    expect(outcome).toEqual({ kind: 'reading', urgent: null });
  });
});

describe('red team: span edges readingOutcome may be given', () => {
  it.each<[string, RejectedSpan[]]>([
    [
      'zero-length spans at both edges',
      [
        { startS: 0, endS: 0, reason: 'coverage' },
        { startS: 40, endS: 40, reason: 'motion' },
      ],
    ],
    ['a reversed span', [{ startS: 20, endS: 10, reason: 'motion' }]],
    [
      'spans wholly before and after the capture',
      [
        { startS: -9, endS: -1, reason: 'coverage' },
        { startS: 41, endS: 50, reason: 'clipping' },
      ],
    ],
    ['a span over the whole capture and beyond', [{ startS: -5, endS: 99, reason: 'coldHands' }]],
    [
      '±Infinity edges',
      [
        { startS: -Infinity, endS: 5, reason: 'motion' },
        { startS: 35, endS: Infinity, reason: 'quality' },
      ],
    ],
    [
      'NaN edges',
      [
        { startS: NaN, endS: 10, reason: 'motion' },
        { startS: 12, endS: NaN, reason: 'coverage' },
      ],
    ],
  ])('%s: no throw, and the seconds add up to the capture', (_, spans) => {
    const analysis = analysisOf('full', 40, spans, null);
    expectSound(analysis, readingOutcome(analysis));
  });

  // LiveSession.readingInput only hands on finite ns spans; a direct caller's NaN-edged span is dropped
  // (its time counts as clean), and an Infinite edge is clipped to the capture.
  it('analyzeReading turns NaN or Infinite caller span edges into spans readingOutcome accepts', () => {
    const capture = captureAt(regularOffsets(30, 40), pulse);
    const startNs = capture.samples[0]!.tNs;
    const { analysis } = judge(capture, {
      motionSpans: [
        { startNs: NaN, endNs: startNs + 5e9 },
        { startNs: startNs + 30e9, endNs: Infinity },
      ],
      coldHandsSpans: [{ startNs: -Infinity, endNs: NaN }],
    });
    expect(analysis.lostSeconds.motion).toBeCloseTo(analysis.durationS - 30, 6);
  });
});

describe('red team: lost-time attribution on random span sets', () => {
  const REASONS: RejectionReason[] = [
    'motion',
    'pressure',
    'coverage',
    'coldHands',
    'quality',
    'clipping',
    'exposure',
  ];
  const TRIALS = 500;
  const uniforms = parkMillerUniforms(TRIALS * 200, 4242);
  let next = 0;
  const draw = () => uniforms[next++]!;
  const edge = (fromS: number) => {
    const roll = draw();
    if (roll < 0.03) return NaN;
    if (roll < 0.06) return fromS < 0 ? -Infinity : Infinity;
    return fromS;
  };

  it(`${TRIALS} seeded span sets: seconds add up, coverage keeps its own, causes are ranked`, () => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const durationS = 1 + 399 * draw();
      const spans = Array.from({ length: Math.floor(12 * draw()) }, (): RejectedSpan => {
        const startS = -5 + (durationS + 10) * draw();
        const lengthS = draw() < 0.1 ? 0 : 30 * draw();
        return {
          startS: edge(startS),
          endS: edge(startS + lengthS),
          reason: REASONS[Math.floor(7 * draw())]!,
        };
      });
      const mode = MODES[Math.floor(MODES.length * draw())]!;
      const analysis = analysisOf(mode, durationS, spans, draw() < 0.5 ? null : 75);
      const outcome = readingOutcome(analysis);
      expectSound(analysis, outcome);
      if (outcome.kind === 'reading') continue;
      const positive = (['coverage', 'motion', 'pressure', 'coldHands'] as const).filter(
        (cause) => outcome.lostSeconds[cause] > 0,
      );
      expect([...outcome.causes].sort()).toEqual([...positive].sort());
      outcome.causes
        .slice(1)
        .forEach((cause, i) =>
          expect(outcome.lostSeconds[cause]).toBeLessThanOrEqual(outcome.lostSeconds[outcome.causes[i]!]),
        );
    }
  });

  it('exact ties keep the §12 coaching order: coverage, motion, pressure, cold hands', () => {
    const outcome = inconclusive(
      readingOutcome(
        analysisOf(
          'quick',
          30,
          [
            { startS: 0, endS: 2, reason: 'coldHands' },
            { startS: 3, endS: 5, reason: 'clipping' },
            { startS: 6, endS: 8, reason: 'motion' },
            { startS: 9, endS: 11, reason: 'coverage' },
          ],
          null,
        ),
      ),
    );
    expect(outcome.causes).toEqual(['coverage', 'motion', 'pressure', 'coldHands']);
  });

  // FAILS on 9dbbb5d. Two 0.7 s spans at whole-ns frame times: coverage 0 s–0.7 s and motion 3 s–3.7 s.
  // 3.7 − 3 is 0.7000000000000002 in doubles, so motion sorts first although both lost 0.7 s. Observed
  // causes ['motion', 'coverage']; expected ['coverage', 'motion'] (ADR 0072 item 6: ties in coaching
  // order), so §12's first tip is about finger contact. Low severity: only the tip order changes.
  it('a tie broken only by float rounding keeps the coaching order', () => {
    const outcome = inconclusive(
      readingOutcome(
        analysisOf(
          'quick',
          30,
          [
            { startS: 0, endS: 0.7, reason: 'coverage' },
            { startS: 3, endS: 3.7, reason: 'motion' },
          ],
          null,
        ),
      ),
    );
    expect(outcome.causes).toEqual(['coverage', 'motion']);
  });
});

describe('red team: modes and purity', () => {
  it.each(['standing', 'Quick', 'quick ', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'mode %j has no target: RangeError',
    (mode) => {
      expect(() => readingOutcome(analysisOf(mode, 400, []))).toThrow(RangeError);
    },
  );

  const deepFreeze = <T>(value: T): T => {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(deepFreeze);
    }
    return value;
  };

  it('a deep-frozen analysis is read, not changed; outcomes are equal and share no objects', () => {
    const analysis = analysisOf(
      'full',
      60,
      [
        { startS: 5, endS: 9, reason: 'motion' },
        { startS: 7, endS: 12, reason: 'coverage' },
      ],
      null,
    );
    const before = structuredClone(analysis);
    deepFreeze(analysis);
    const first = inconclusive(readingOutcome(analysis));
    const second = inconclusive(readingOutcome(analysis));
    expect(first).toEqual(second);
    first.lostSeconds.motion = -1;
    first.causes.push('coldHands');
    expect(second.lostSeconds.motion).toBeCloseTo(2, 9);
    expect(second.causes).toEqual(['coverage', 'motion']);
    expect(analysis).toEqual(before);
  });
});
