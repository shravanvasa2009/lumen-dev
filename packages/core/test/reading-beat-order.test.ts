import { analyzeReading, type DetectedBeat, type ReadingContext } from '../src';
import { beatTimes, beatTrain } from './redteam/attacks';
import { captureAt, regularOffsets } from './synthetic';

// DSP-7 no longer emits a peak at or before the previous one (ADR 0068), so the detector's output is
// edited here to put such a pair in front of analyzeReading's DSP-15 inputs.
let editBeats: (beats: DetectedBeat[]) => DetectedBeat[] = (beats) => beats;
jest.mock('../src/beats', () => {
  const actual = jest.requireActual<typeof import('../src/beats')>('../src/beats');
  return {
    ...actual,
    detectBeats: (...args: Parameters<typeof actual.detectBeats>) => editBeats(actual.detectBeats(...args)),
  };
});

const context: ReadingContext = {
  captureFps: 60,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  validationRhythmLabel: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
};

// A regular 75 bpm reading whose one segment has exactly 40 accepted intervals: just enough for DSP-15.
const SECONDS = 32.7;
const capture = captureAt(regularOffsets(60, SECONDS), beatTrain(beatTimes([0.8], SECONDS)));

const duplicateBeat = (index: number) => (beats: DetectedBeat[]) => [
  ...beats.slice(0, index + 1),
  beats[index]!,
  ...beats.slice(index + 1),
];
const reversedBeat = (index: number) => (beats: DetectedBeat[]) => [
  ...beats.slice(0, index + 1),
  { ...beats[index]!, peakS: beats[index]!.peakS - 0.29 },
  ...beats.slice(index + 1),
];

describe('analyzeReading with two beats at the same or reversed times (DSP-15 inputs)', () => {
  afterEach(() => {
    editBeats = (beats) => beats;
  });

  it('starts from a reading with exactly 40 usable intervals', () => {
    const analysis = analyzeReading(capture, context);
    expect(analysis.intervals.filter((interval) => interval.accepted)).toHaveLength(40);
    expect(analysis.enoughRhythmIntervals).toBe(true);
  });

  it.each([
    ['the same peak twice', duplicateBeat(20)],
    ['a peak 0.29 s before the previous one', reversedBeat(20)],
  ])('does not throw on %s, and the pair counts as an artifact interval', (_label, edit) => {
    editBeats = edit;
    const analysis = analyzeReading(capture, context);
    for (const window of analysis.rhythmWindows)
      for (const intervalS of window.intervalsS) expect(intervalS).toBeGreaterThan(0);
    // The bridging interval is no longer usable, so 39 remain: below DSP-15's 40.
    expect(analysis.enoughRhythmIntervals).toBe(false);
    // The same rule for the reading's intervals (replay output, the fast-regular rule's normalized RMSSD).
    const accepted = analysis.intervals.filter((interval) => interval.accepted);
    expect(accepted).toHaveLength(39);
    for (const interval of accepted) expect(interval.ibiMs).toBeGreaterThan(0);
    for (const interval of analysis.intervals) expect(interval.ibiMs).toBeGreaterThan(0);
  });
});
