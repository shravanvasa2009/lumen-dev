import type { CaptureStatus, ClassifiedBeat, LiveSession, ReadingResult, SampleBatch } from '../src';

// These are type-shape checks: tsc (run before jest) fails if the types drift from the spec. No DSP runs.

// Verbatim from Appendix B "Results JSON (one reading)".
const appendixBExample: ReadingResult = {
  headlineKey: 'result.regular',
  cleanSeconds: 92,
  beats: 104,
  rejectedBeats: 6,
  metrics: {
    hr: { value: 64, unit: 'bpm', evidence: 'checked', confidence: 'high', flag: null },
    rhythm: { class: 'sinus', pAF: 0.03, evidence: 'public-data', confidence: 'high', flag: null },
    rmssd: { value: 48, unit: 'ms', band: [41, 55], evidence: 'checked', confidence: 'moderate' },
    resp: { value: 14, unit: 'br/min', evidence: 'checked', confidence: 'moderate' },
    diabetes: {
      probability: 0.62,
      readingsUsed: 2,
      evidence: 'public-data',
      confidence: 'moderate',
      flag: 'pattern',
    },
  },
  experimental: {
    extraBeatsPerMin: 0.7,
    longPauses: 0,
    pulseShape: { available: true },
  },
  lostSeconds: { motion: 4, pressure: 2, coverage: 0, coldHands: 0 },
  notChecked: ['bp', 'spo2', 'heartAttack'],
};

// 40 clean s clears the HR floor (15 s) but not rhythm, HRV, or breathing (60 s, §6.2). Every Appendix C
// result.* headline is a rhythm statement, and the only one for a missed floor is result.inconclusive;
// the HR card still stands on its own (§7).
const rhythmBelowFloor: ReadingResult = {
  ...appendixBExample,
  headlineKey: 'result.inconclusive',
  cleanSeconds: 40,
  metrics: { ...appendixBExample.metrics, rhythm: null, rmssd: null, resp: null, diabetes: null },
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
  recentWaveform: { tS: [], ppg: [] },
  coachingKey: 'coach.cover',
  rejectedSpans: [{ startS: 3, endS: 5, reason: 'quality' }],
  sqiWindow: null,
};

describe('Results contract types (Appendix B)', () => {
  it('ReadingResult accepts the spec example and null cards below their floor', () => {
    expect(appendixBExample.metrics.hr?.value).toBe(64);
    expect(rhythmBelowFloor.metrics.rhythm).toBeNull();
  });
});

describe('Live session contract types', () => {
  it('ClassifiedBeat carries a class and a separate longPause flag (DSP-9 shape only)', () => {
    expect([atypicalBeat.beatClass, beatAfterLongPause.longPause]).toEqual(['atypical', true]);
  });

  it('LiveSession allows a null sqiWindow (shape only)', () => {
    expect(idleSession.sqiWindow).toBeNull();
  });
});
