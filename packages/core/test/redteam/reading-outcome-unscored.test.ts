import {
  analyzeReading,
  cleanSeconds,
  createLiveSession,
  DSP_CONFIG,
  readingOutcome,
  type CaptureStatus,
  type ReadingAnalysis,
  type ReadingContext,
  type RejectedSpan,
} from '../../src';
import { captureAt } from '../synthetic';
import { beatTimes, beatTrain, type Channels } from './attacks';

// Red team for b146460 (PR #171, 5806fad). unscoredSpan now starts at the frame ending the latest DSP-2
// gap, on the claim that the seconds before the gap "were in earlier windows". They were not always: the
// up to 1 s between the last once-per-second check and the stall, a stretch shorter than 4 s between two
// stalls, and the first seconds of a reading that stalls before 4 s are in no SQI-Net window, yet after
// 5806fad no span marks them, so they count as clean although SQI-Net never saw them (ADR 0057 says
// unscored time is not clean once SQI-Net runs). The invariant: once SQI-Net has run, every clean second
// up to the last scored window's end lies inside a window SQI-Net scored clean. SQI here is a fixed 0.9
// stand-in for the model; frames at 30 fps, batches of 3 frames, a still finger.

const CONTEXT: ReadingContext = {
  captureFps: 30,
  tier: 'basic',
  mode: 'quick',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};
const STILL: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 30,
  droppedFrac: 0,
};
const WINDOW_S = DSP_CONFIG.dsp3.modelWindowS;
const SQI_THRESHOLD = 0.5;

const pulse75: Channels = beatTrain(beatTimes([0.8], 1000), 0.3);

// Frame times in seconds, whole ns, 30 fps from fromS through toS.
const framesS = (fromS: number, toS: number) =>
  Array.from(
    { length: Math.floor((toS - fromS) * 30 + 1e-9) + 1 },
    (_, k) => Math.round(fromS * 1e9 + (k * 1e9) / 30) / 1e9,
  );

// Clean stretches of segmentS, each followed by a stall of stallS, after an opening clean firstS.
function periodicStalls(firstS: number, segmentS: number, stallS: number, untilS: number): number[] {
  const offsets = framesS(0, firstS);
  while (offsets[offsets.length - 1]! < untilS) {
    const resumeS = offsets[offsets.length - 1]! + stallS;
    offsets.push(...framesS(resumeS, resumeS + segmentS));
  }
  return offsets;
}

// The app's loop: every new SQI-Net window is scored pClean; then the saved analysis of readingInput.
function replay(
  offsets: number[],
  pClean: number,
  mode: string,
): { analysis: ReadingAnalysis; scoredEnds: number[] } {
  const capture = captureAt(offsets, pulse75);
  const session = createLiveSession({
    captureFps: 30,
    sqiThreshold: SQI_THRESHOLD,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  const scoredEnds: number[] = [];
  for (let start = 0; start < capture.samples.length; start += 3) {
    session.pushSamples({
      samples: capture.samples.slice(start, start + 3),
      stats: capture.stats.slice(start, start + 3),
    });
    session.pushStatus(STILL);
    const window = session.sqiWindow;
    if (window && window.endS !== scoredEnds[scoredEnds.length - 1]) {
      scoredEnds.push(window.endS);
      session.setSqi(window.endS, pClean);
    }
  }
  const { capture: frames, ...spans } = session.readingInput();
  return { analysis: analyzeReading(frames, { ...CONTEXT, mode, ...spans }), scoredEnds };
}

// Clean seconds up to the last scored window's end that lie in no scored window.
function neverScoredCleanS(analysis: ReadingAnalysis, scoredEnds: number[]): number {
  const lastEndS = scoredEnds[scoredEnds.length - 1]!;
  const outsideWindows: RejectedSpan[] = [];
  let reachedS = 0;
  for (const endS of scoredEnds) {
    if (endS - WINDOW_S > reachedS)
      outsideWindows.push({ startS: reachedS, endS: endS - WINDOW_S, reason: 'quality' });
    reachedS = Math.max(reachedS, endS);
  }
  return (
    cleanSeconds(0, lastEndS, analysis.rejectedSpans) -
    cleanSeconds(0, lastEndS, [...analysis.rejectedSpans, ...outsideWindows])
  );
}

describe('red team: unscoredSpan from the latest gap leaves seconds before a stall unscored but clean', () => {
  // FAILS on b146460; 0 s on 808f37c except where noted. Observed never-scored clean seconds on b146460:
  // one stall 20.95→21.50 s: 0.933; one stall 20.95→21.11 s: 0.933; stalls 20.00→20.50 and 23.95→24.20 s:
  // 0.933; stalls at 10.9, 14.9, 18.9 s (0.2 s each): 2.700; a stall 2.00→2.20 s: 2.000; a stall
  // 3.95→4.20 s: 3.933 (0.200 on 808f37c, the [0, 0.2] s before the first check's span); a stall
  // 4.50→4.70 s: 0.500.
  it.each([
    ['one 550 ms stall at 20.95 s', [...framesS(0, 20.95), ...framesS(21.5, 40)]],
    ['one 160 ms stall at 20.95 s', [...framesS(0, 20.95), ...framesS(21.11, 40)]],
    ['two stalls 3.45 s apart', [...framesS(0, 20), ...framesS(20.5, 23.95), ...framesS(24.2, 40)]],
    [
      'three 200 ms stalls 3.8 s apart',
      [...framesS(0, 10.9), ...framesS(11.1, 14.9), ...framesS(15.1, 18.9), ...framesS(19.1, 40)],
    ],
    ['a 200 ms stall at 2 s', [...framesS(0, 2), ...framesS(2.2, 40)]],
    ['a 250 ms stall at 3.95 s', [...framesS(0, 3.95), ...framesS(4.2, 40)]],
    ['a 200 ms stall at 4.5 s', [...framesS(0, 4.5), ...framesS(4.7, 40)]],
  ])('%s: every clean second was scored by SQI-Net', (_name, offsets) => {
    const { analysis, scoredEnds } = replay(offsets, 0.9, 'quick');
    expect(neverScoredCleanS(analysis, scoredEnds)).toBeLessThan(1e-6);
  });

  // Control: no gap, nothing leaks (passes on b146460).
  it('no stall: every clean second was scored by SQI-Net', () => {
    const { analysis, scoredEnds } = replay(framesS(0, 40), 0.9, 'quick');
    expect(neverScoredCleanS(analysis, scoredEnds)).toBeLessThan(1e-6);
  });
});

describe('red team: periodic stalls (thermal throttling) reach the mode target with almost nothing scored', () => {
  // FAILS on b146460. 5 s clean, then 3.84 s stretches each followed by a 160 ms stall: no stretch holds a
  // 4 s window, so SQI-Net scores only the first 2 windows (pClean 0.9), yet each stretch's last ~0.9 s
  // counts clean. Quick to 140 s: b146460 saved 34.37 clean s, a reading; 808f37c 2.79, inconclusive.
  it('Quick, 140 s of 3.84 s stretches and 160 ms stalls: short of Quick, a lower-quality reading', () => {
    const { analysis, scoredEnds } = replay(periodicStalls(5, 3.84, 0.16, 140), 0.9, 'quick');
    expect(scoredEnds.length).toBeLessThanOrEqual(2);
    expect(analysis.cleanSeconds).toBeLessThan(DSP_CONFIG.rules.modeMinCleanS.quick);
    // ADR 0104: below the target a capture with a heart rate is still a reading, tagged lower quality.
    expect(analysis.heartRateBpm).toBeNull();
    expect(readingOutcome(analysis).kind).toBe(
      analysis.lowQuality.heartRateBpm === null ? 'inconclusive' : 'reading',
    );
  });

  // Every window scored 0. Before the owner made SQI-Net advisory (2026-10-06) this was a veto: 808f37c 0.77
  // clean s. Now the scores reject nothing: the clean count is the 0.9 run's, and every scored window is flagged.
  it('every scored window scored 0: the 0.9 clean count, every scored window flagged', () => {
    const { analysis, scoredEnds } = replay(periodicStalls(5, 3.84, 0.16, 140), 0, 'quick');
    const { analysis: passing } = replay(periodicStalls(5, 3.84, 0.16, 140), 0.9, 'quick');
    expect(analysis.cleanSeconds).toBeCloseTo(passing.cleanSeconds, 9);
    expect(analysis.sqiFlagged).toEqual({ windows: scoredEnds.length, total: scoredEnds.length });
  });
});

describe('red team: a stall before the first 4 s turns unscored seconds into a Quick reading', () => {
  // FAILS on b146460. A 250 ms stall at 3.95 s, then frames to 34.10 s: [0, 3.95] s is in no window yet
  // counts clean, so b146460 saves 30.03 clean s (3.93 never scored) and a reading; at a last frame of
  // 33.70 s it saves 29.63, inconclusive. Scored clean time is about 26.1 s, short of the Quick target.
  it('Quick, a 250 ms stall at 3.95 s, last frame at 34.10 s: short of Quick on scored time', () => {
    const { analysis, scoredEnds } = replay([...framesS(0, 3.95), ...framesS(4.2, 34.1)], 0.9, 'quick');
    const scoredCleanS = analysis.cleanSeconds - neverScoredCleanS(analysis, scoredEnds);
    expect(scoredCleanS).toBeLessThan(DSP_CONFIG.rules.modeMinCleanS.quick);
    expect(analysis.cleanSeconds).toBeLessThan(DSP_CONFIG.rules.modeMinCleanS.quick);
    expect(readingOutcome(analysis).kind).toBe('reading');
  });
});
