import { act, renderHook, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { ReplayCapture, type RecordedCapture } from '../../modules/lumen-capture/src';
import en from '@/i18n/en.json';
import { listReadings, storedReadingById } from '@/store/readings';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { keepCapture, keptCapture } from './keptCapture';
import { useLiveCapture } from './useLiveCapture';
import { useReadingAnalysis } from './useReadingAnalysis';

// The first render in a Jest process loads react-native lazily (see LabPanel.test.tsx), and 40 s of replay
// runs the session over 2,400 frames.
jest.setTimeout(60_000);
preloadAppRoutes();

const FPS = 60;
const FRAME_NS = 1e9 / FPS;
const PULSE_HZ = 1.2; // 72 beats/min

// SYNTHETIC: a smooth pulse in red on a covered lens. It exercises the plumbing, not any person's signal.
// `liftedFromS`..`liftedToS` is a finger lifted off the lens: bright, with no red dominance.
function syntheticRecording(seconds: number, lifted?: [number, number]): RecordedCapture {
  const frames = Math.round(seconds * FPS);
  const tNs = Array.from({ length: frames }, (_, i) => 1e12 + i * FRAME_NS);
  const timeS = (i: number) => i / FPS;
  const isLifted = (i: number) => lifted !== undefined && timeS(i) >= lifted[0] && timeS(i) < lifted[1];
  const phase = (i: number) => 2 * Math.PI * PULSE_HZ * timeS(i);
  return {
    capabilities: {
      platform: 'android',
      modelId: 'synthetic-phone',
      osVersion: '0',
      rearLenses: [{ id: 'synthetic-wide', kind: 'wide', maxFps: FPS, torchUsable: true }],
      torch: { available: true, levels: true },
      locks: { exposure: true, whiteBalance: true, focus: true },
    },
    samples: {
      tNs,
      r: tNs.map((_, i) =>
        isLifted(i) ? 0.3 : 0.7 - 0.012 * (Math.sin(phase(i)) + 0.3 * Math.sin(2 * phase(i))),
      ),
      g: tNs.map((_, i) => (isLifted(i) ? 0.3 : 0.1)),
      b: tNs.map((_, i) => (isLifted(i) ? 0.3 : 0.1)),
    },
    stats: {
      tNs,
      spatialStdR: tNs.map(() => 0.02),
      clipFrac: tNs.map(() => 0),
      exposureNs: tNs.map(() => 8e6),
    },
  };
}

async function replayFor(recording: RecordedCapture, seconds: number) {
  const replay = new ReplayCapture(recording);
  const live = renderHook(() => useLiveCapture(replay));
  await act(async () => {});
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
  return live;
}

beforeEach(() => {
  jest.useFakeTimers();
  keepCapture(null);
  emptyMockDatabases();
});
afterEach(() => jest.useRealTimers());

describe('live capture fed by a LiveSession', () => {
  it('counts clean seconds and shows the filtered pulse of the last 6 s from the session', async () => {
    const { result: live } = await replayFor(syntheticRecording(30), 12);
    expect(live.current.phase).toBe('running');
    expect(live.current.cleanSeconds).toBeGreaterThan(10);
    expect(live.current.cleanSeconds).toBeLessThanOrEqual(12);
    expect(live.current.advancing).toBe(true);
    expect(live.current.coachingKey).toBeNull();
    expect(live.current.rejectedSpans).toEqual([]);
    const { tS, ppg } = live.current.recentWaveform;
    expect(ppg).toHaveLength(tS.length);
    expect(tS.at(-1)! - tS[0]!).toBeGreaterThan(5.5);
    expect(tS.at(-1)! - tS[0]!).toBeLessThanOrEqual(6);
  });

  it('pauses the count and coaches to cover the lens while the finger is lifted', async () => {
    const { result: live } = await replayFor(syntheticRecording(30, [8, 12]), 11);
    expect(live.current.coachingKey).toBe('coach.cover');
    const during = live.current.cleanSeconds!;
    expect(during).toBeLessThan(9);
    expect(live.current.rejectedSpans.some((span) => span.reason === 'coverage')).toBe(true);
    expect(live.current.advancing).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(live.current.cleanSeconds).toBe(during);
  });

  it('does not count, and says so, while every frame is clipped', async () => {
    const recording = syntheticRecording(30);
    const clipped = {
      ...recording,
      stats: { ...recording.stats!, clipFrac: recording.stats!.clipFrac.map(() => 0.9) },
    };
    const { result: live } = await replayFor(clipped, 12);
    expect(live.current.cleanSeconds).toBeLessThan(1);
    expect(live.current.advancing).toBe(false);
  });

  it('leaves clean seconds out when the module sends stats that do not match its samples', async () => {
    const recording = syntheticRecording(10);
    const withoutStats = { ...recording, stats: undefined };
    const { result: live } = await replayFor(withoutStats, 3);
    expect(live.current.cleanSeconds).toBeNull();
    expect(live.current.failure).toMatch(/stats/i);
  });

  it('keeps the frames and the session spans for the Processing screen', async () => {
    const recording = syntheticRecording(30, [8, 10]);
    await replayFor(recording, 20);
    const kept = keptCapture();
    // The session gets exactly the rate start() reports; Replay reports 1e9 / the median frame interval (ADR 0067).
    const gaps = recording.samples.tNs
      .slice(1)
      .map((tNs, i) => tNs - recording.samples.tNs[i]!)
      .sort((a, b) => a - b);
    expect(kept?.captureFps).toBe(1e9 / gaps[Math.floor(gaps.length / 2)]!);
    expect(kept?.samples.length).toBe(kept?.stats.length);
    expect(kept?.samples.length).toBeGreaterThan(19 * FPS);
    expect(kept?.motionSpans).toEqual([]);
    expect(kept?.sqi).toBeNull();
  });

  it('builds the kept capture from the session, with the frames exactly as the module sent them', async () => {
    const recording = syntheticRecording(30);
    await replayFor(recording, 5);
    const kept = keptCapture();
    if (!kept) throw new Error('nothing was kept');
    expect(kept.samples.map((sample) => sample.tNs)).toEqual(
      recording.samples.tNs.slice(0, kept.samples.length),
    );
    expect(kept.samples[0]?.r).toBe(recording.samples.r[0]);
    // The same object until more frames arrive, so one capture is analysed and saved once.
    expect(keptCapture()).toBe(kept);
  });
});

describe('reading analysis of a kept capture', () => {
  it('stays unavailable with nothing kept', () => {
    const { result: analysis } = renderHook(() => useReadingAnalysis({ mode: 'quick', restTimerDone: true }));
    expect(analysis.current).toEqual({ phase: 'unavailable' });
  });

  it('runs analyzeReading and the decision rules to a reading id, with every step reported', async () => {
    await replayFor(syntheticRecording(40), 40);
    jest.useRealTimers();
    const phases: string[] = [];
    const { result: analysis } = renderHook(() => {
      const state = useReadingAnalysis({ mode: 'quick', restTimerDone: true });
      phases.push(state.phase);
      return state;
    });
    await waitFor(() => expect(analysis.current.phase).toBe('done'), { timeout: 10_000 });
    const done = analysis.current;
    if (done.phase !== 'done') throw new Error('analysis did not finish');
    expect(done.readingId).toMatch(/^reading-\d+$/);
    expect(done.progress.steps).toEqual({
      beats: 'done',
      rhythm: 'done',
      breathing: 'done',
      baseline: 'done',
    });
    expect(phases).toContain('running');
    const saved = await storedReadingById(done.readingId);
    if (!saved) throw new Error('the finished reading was not saved');
    const reading = saved.outcome;
    expect(saved.mode).toBe('quick');
    expect(done.progress.beats).toBe(reading.beats);
    expect(done.progress.rejectedBeats).toBe(reading.rejectedBeats);
    expect(reading.cleanSeconds).toBeGreaterThan(35);
    expect(reading.metrics.hr?.value).toBeCloseTo(PULSE_HZ * 60, -1);
    // No evidence.json entry has passed, so EVID-1 leaves every card Experimental.
    expect(reading.metrics.hr?.evidence).toBe('experimental');
  });

  it('opens the finished reading on Results, not the inconclusive page', async () => {
    await replayFor(syntheticRecording(40), 40);
    jest.useRealTimers();
    const { result: analysis } = renderHook(() => useReadingAnalysis({ mode: 'quick', restTimerDone: true }));
    await waitFor(() => expect(analysis.current.phase).toBe('done'), { timeout: 10_000 });
    if (analysis.current.phase !== 'done') throw new Error('analysis did not finish');
    const stored = await storedReadingById(analysis.current.readingId);
    if (!stored) throw new Error('the finished reading was not saved');

    renderRouter('./app', { initialUrl: `/results/${analysis.current.readingId}` });
    // A Quick Check judges no rhythm (ADR 0089): a good heart rate is headlined alone, with no retake asked.
    expect(stored.outcome.headlineKey).toBe('result.hrOnly');
    expect(await screen.findByText(en['result.hrOnly'])).toBeOnTheScreen();
    expect(screen.queryByText(en['result.uncertain'])).toBeNull();
    expect(screen.getByText(en['checks.state.off'])).toBeOnTheScreen();
  });

  it('reports a capture it cannot analyse as failed, with the reason and the steps so far', async () => {
    jest.useRealTimers();
    keepCapture({
      captureFps: FPS,
      lensId: null,
      samples: [{ tNs: 1, r: 0.7, g: 0.1, b: 0.1 }],
      stats: [],
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
    });
    const { result: analysis } = renderHook(() => useReadingAnalysis({ mode: 'quick', restTimerDone: true }));
    await waitFor(() => expect(analysis.current.phase).toBe('failed'), { timeout: 10_000 });
    const failed = analysis.current;
    if (failed.phase !== 'failed') throw new Error('analysis did not fail');
    expect(failed.reason).not.toBe('');
    expect(failed.progress.steps.beats).toBe('active');
  });

  const refusalFor = async (samples: { tNs: number; r: number }[]) => {
    jest.useRealTimers();
    keepCapture({
      captureFps: FPS,
      lensId: null,
      samples: samples.map(({ tNs, r }) => ({ tNs, r, g: 0.1, b: 0.1 })),
      stats: samples.map(({ tNs }) => ({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 })),
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
    });
    const { result: analysis } = renderHook(() => useReadingAnalysis({ mode: 'quick', restTimerDone: true }));
    await waitFor(() => expect(analysis.current.phase).toBe('inconclusive'), { timeout: 10_000 });
    // A refused capture is not a reading: nothing reaches the readings table.
    expect(await listReadings()).toEqual([]);
    return analysis.current;
  };

  it('refuses a capture too short to measure without saving it, not as a failure', async () => {
    const refused = await refusalFor([{ tNs: 1e12, r: 0.7 }]);
    expect(refused).toMatchObject({ phase: 'inconclusive', outcome: null });
  });

  it('refuses a capture with no finger on the lens and hands over its numbers', async () => {
    const frames = Array.from({ length: 40 * FPS }, (_, i) => ({ tNs: 1e12 + i * FRAME_NS, r: 0.05 }));
    const refused = await refusalFor(frames);
    expect(refused).toMatchObject({
      phase: 'inconclusive',
      outcome: { kind: 'inconclusive', cleanSeconds: 0, neededCleanSeconds: 30 },
    });
  });

  it('still analyses and saves a capture with a few NaN frames, which are just not clean', async () => {
    jest.useRealTimers();
    // A Quick Check needs 30 clean seconds (spec 07), so the capture runs 35 s.
    const captureS = 35;
    const frames = Array.from({ length: captureS * FPS }, (_, i) => 1e12 + i * FRAME_NS);
    keepCapture({
      captureFps: FPS,
      lensId: null,
      samples: frames.map((tNs, i) => ({
        tNs,
        r: i >= 300 && i < 303 ? Number.NaN : 0.7 - 0.012 * Math.sin(2 * Math.PI * PULSE_HZ * (i / FPS)),
        g: 0.1,
        b: 0.1,
      })),
      stats: frames.map((tNs) => ({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 })),
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
    });
    const { result: analysis } = renderHook(() => useReadingAnalysis({ mode: 'quick', restTimerDone: true }));
    await waitFor(() => expect(analysis.current.phase).toBe('done'), { timeout: 10_000 });
    if (analysis.current.phase !== 'done') throw new Error('analysis did not finish');
    const saved = await storedReadingById(analysis.current.readingId);
    if (!saved) throw new Error('the reading was not saved');
    expect(saved.outcome.cleanSeconds).toBeLessThan(captureS);
  });
});
