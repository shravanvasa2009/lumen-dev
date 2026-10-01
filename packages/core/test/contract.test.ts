import type {
  AnalyzeReading,
  ClassifiedBeat,
  LiveSession,
  ReadingResult,
  SampleBatch,
  CaptureStatus,
} from '../src';

// Verbatim from Appendix B "Results JSON (one reading)"; tsc fails if the types drift from the spec.
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

// §7: a card that misses its clean-data floor shows "Not enough clean signal" while the rest stands.
const rhythmBelowFloor: ReadingResult = {
  ...appendixBExample,
  cleanSeconds: 40,
  metrics: { ...appendixBExample.metrics, rhythm: null, rmssd: null, resp: null, diabetes: null },
};

// DSP-9: an atypical (possibly premature) beat is kept, and a long pause is a flag, not a class.
const keptPrematureBeat: ClassifiedBeat = {
  peakS: 12.41,
  onsetS: 12.3,
  beatClass: 'atypical',
  longPause: false,
};
const afterSkippedBeat: ClassifiedBeat = {
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
  rejectedSpans: [{ startS: 3, endS: 5, reason: 'motion' }],
};
const analyzeFixture: AnalyzeReading = () => appendixBExample;

describe('Results contract (Appendix B)', () => {
  it('accepts the spec example and a reading with cards below their floor', () => {
    expect(appendixBExample.metrics.hr?.value).toBe(64);
    expect(rhythmBelowFloor.metrics.rhythm).toBeNull();
    expect(analyzeFixture(idleSession).notChecked).toEqual(['bp', 'spo2', 'heartAttack']);
  });

  it('keeps atypical beats and marks long pauses separately (DSP-9)', () => {
    expect([keptPrematureBeat.beatClass, afterSkippedBeat.longPause]).toEqual(['atypical', true]);
  });
});
