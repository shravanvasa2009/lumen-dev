import type { CaptureStatus, ClassifiedBeat, LiveSession, ReadingResult, SampleBatch } from '../src';

// These are type-shape checks: tsc (run before jest) fails if the types drift from the spec. No DSP runs.

// Appendix B "Results JSON (one reading)", with ADR 0104's quality fields.
const STANDARD = { quality: 'standard' as const, qualityReasons: [] };
const appendixBExample: ReadingResult = {
  headlineKey: 'result.regular',
  quality: { level: 'standard', reasons: [] },
  cleanSeconds: 92,
  beats: 104,
  rejectedBeats: 6,
  metrics: {
    hr: { value: 64, unit: 'bpm', evidence: 'checked', confidence: 'high', flag: null, ...STANDARD },
    rhythm: {
      class: 'sinus',
      pAF: 0.03,
      evidence: 'public-data',
      confidence: 'high',
      flag: null,
      ...STANDARD,
    },
    rmssd: {
      value: 48,
      unit: 'ms',
      band: [41, 55],
      evidence: 'checked',
      confidence: 'moderate',
      ...STANDARD,
    },
    resp: { value: 14, unit: 'br/min', evidence: 'checked', confidence: 'moderate', ...STANDARD },
    diabetes: {
      probability: 0.62,
      readingsUsed: 2,
      evidence: 'public-data',
      confidence: 'moderate',
      flag: 'pattern',
      ...STANDARD,
    },
  },
  experimental: {
    extraBeatsPerMin: 0.7,
    longPauses: 0,
    pulseShape: { available: true },
    ...STANDARD,
  },
  lostSeconds: { motion: 4, pressure: 2, coverage: 0, coldHands: 0 },
  notChecked: ['bp', 'spo2', 'heartAttack'],
};

// 40 clean s clears the HR floor (15 s) but not rhythm (60 s, §6.2): the rhythm card is tagged lower quality
// with the floor it missed (ADR 0104), and with no rhythm model at all there is no card.
const SHORT = { kind: 'shortClean', haveS: 40, wantS: 60 } as const;
const rhythmBelowFloor: ReadingResult = {
  ...appendixBExample,
  headlineKey: 'result.regular',
  quality: { level: 'low', reasons: [SHORT] },
  cleanSeconds: 40,
  metrics: {
    ...appendixBExample.metrics,
    rhythm: {
      class: 'sinus',
      pAF: 0.03,
      evidence: 'experimental',
      confidence: 'low',
      flag: null,
      quality: 'low',
      qualityReasons: ['shortClean'],
    },
    rmssd: null,
    resp: null,
    diabetes: null,
  },
};

const atypicalBeat: ClassifiedBeat = {
  peakS: 12.41,
  onsetS: 12.3,
  beatClass: 'atypical',
  longPause: false,
};
const beatAfterLongPause: ClassifiedBeat = {
  peakS: 14.02,
  onsetS: 13.91,
  beatClass: 'normal',
  longPause: true,
};

const idleSession: LiveSession = {
  pushSamples: (_batch: SampleBatch) => undefined,
  pushStatus: (_status: CaptureStatus) => undefined,
  setSqi: (_windowEndS: number, _pClean: number) => undefined,
  cleanSeconds: 0,
  perfusionPct: null,
  recentWaveform: { tS: [], ppg: [] },
  coachingKey: 'coach.cover',
  rejectedSpans: [{ startS: 3, endS: 5, reason: 'quality' }],
  sqiWindow: null,
  // H-025 shape, as the owner approved it.
  readingInput: () => ({
    capture: { samples: [], stats: [] },
    motionSpans: [{ startNs: 1_000_000_000, endNs: 2_000_000_000 }],
    coldHandsSpans: [],
    sqi: null,
  }),
};

describe('Results contract types (Appendix B)', () => {
  it('ReadingResult accepts the spec example and a lower-quality card below its floor', () => {
    expect(appendixBExample.metrics.hr?.value).toBe(64);
    expect(rhythmBelowFloor.metrics.rhythm?.quality).toBe('low');
  });
});

describe('Live session contract types', () => {
  it('ClassifiedBeat carries a class and a separate longPause flag (DSP-9 shape only)', () => {
    expect([atypicalBeat.beatClass, beatAfterLongPause.longPause]).toEqual(['atypical', true]);
  });

  it('LiveSession allows a null sqiWindow (shape only)', () => {
    expect(idleSession.sqiWindow).toBeNull();
  });

  it('LiveSession.readingInput allows a null sqi (shape only)', () => {
    expect(idleSession.readingInput().sqi).toBeNull();
  });
});
