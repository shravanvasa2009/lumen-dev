import { act, renderHook } from '@testing-library/react-native';

import { ReplayCapture, type RecordedCapture } from '../../modules/lumen-capture/src';

import { captureVerdict } from './captureVerdict';
import { keepCapture, keptCapture } from './keptCapture';
import { useLiveCapture } from './useLiveCapture';

// The model files are not bundled yet, so a test double stands in for the ONNX runtime: it scores every 4 s
// window as not clean. What is under test is the wiring: the 1 s cadence, the window input, and the spans.
const mockScoreSqiWindow = jest.fn(async (window: Float32Array) => ({
  source: 'model' as const,
  pClean: window.length === 256 ? 0.1 : 1,
}));
jest.mock('../ml/runtime', () => ({
  sqiThreshold: () => 0.5,
  scoreSqiWindow: (window: Float32Array) => mockScoreSqiWindow(window),
}));

jest.setTimeout(60_000);

const FPS = 60;
// SYNTHETIC covered-lens recording: a smooth pulse in red.
function syntheticRecording(seconds: number): RecordedCapture {
  const tNs = Array.from({ length: seconds * FPS }, (_, i) => 1e12 + (i * 1e9) / FPS);
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
      r: tNs.map((_, i) => 0.7 - 0.012 * Math.sin((2 * Math.PI * 1.2 * i) / FPS)),
      g: tNs.map(() => 0.1),
      b: tNs.map(() => 0.1),
    },
    stats: {
      tNs,
      spatialStdR: tNs.map(() => 0.02),
      clipFrac: tNs.map(() => 0),
      exposureNs: tNs.map(() => 8e6),
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  keepCapture(null);
});
afterEach(() => jest.useRealTimers());

// Owner 2026-10-06 ("Advisory + tag"): SQI-Net's low scores no longer stop the count.
it('scores a 256-sample window about once a second, and a low P(clean) rejects nothing', async () => {
  const replay = new ReplayCapture(syntheticRecording(20));
  const { result: live } = renderHook(() => useLiveCapture(replay));
  await act(async () => {});
  for (let elapsed = 0; elapsed < 14; elapsed += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
  // 4 s of covered signal first, then one window per second.
  expect(mockScoreSqiWindow.mock.calls.length).toBeGreaterThanOrEqual(8);
  expect(mockScoreSqiWindow.mock.calls.length).toBeLessThanOrEqual(11);
  expect(live.current.rejectedSpans.some((span) => span.reason === 'quality')).toBe(false);
  // Every scored window was flagged, yet the count kept up with the frames (it once stopped under 8 s).
  expect(live.current.cleanSeconds).toBeGreaterThan(12);

  const kept = keptCapture();
  expect(kept?.sqi?.threshold).toBe(0.5);
  expect(kept?.sqi?.windows.length).toBe(mockScoreSqiWindow.mock.calls.length);
  expect(kept?.sqi?.windows.every((window) => window.pClean === 0.1)).toBe(true);
});

// Owner 2026-10-06 ("sometimes it will stop at like 3 seconds this feels very unexplained"). A Galaxy A17 steers
// exposure compensation for a few seconds after the finger goes on, and each change greys about 1 s (DSP-5).
// Replayed here: an exposure step every 0.8 s from 2 to 5.2 s (grey from 2 to 6.2 s) while lockExposure takes
// 3.5 s to settle, then a 1 s frame gap at 12 s. Every stopped moment must say why: brightness while steering or in its grey seconds, else "not clean".
class SteeringReplay extends ReplayCapture {
  settledAt: number | null = null;
  override async lockExposure(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 3500));
    this.settledAt = Date.now();
  }
}

function steeringRecording(): RecordedCapture {
  const recording = syntheticRecording(20);
  const keep = recording.samples.tNs.map((tNs) => tNs < 1e12 + 12e9 || tNs >= 1e12 + 13e9);
  const pick = <T>(values: T[]) => values.filter((_, i) => keep[i]);
  const exposureNs = recording.stats!.tNs.map((tNs) => {
    const tS = (tNs - 1e12) / 1e9;
    return 8e6 - 2e5 * Math.min(5, Math.max(0, Math.floor((tS - 2) / 0.8) + 1));
  });
  return {
    ...recording,
    samples: {
      tNs: pick(recording.samples.tNs),
      r: pick(recording.samples.r),
      g: pick(recording.samples.g),
      b: pick(recording.samples.b),
    },
    stats: {
      tNs: pick(recording.stats!.tNs),
      spatialStdR: pick(recording.stats!.spatialStdR),
      clipFrac: pick(recording.stats!.clipFrac),
      exposureNs: pick(exposureNs),
    },
  };
}

it('explains every stopped second: brightness while the lock steers and in its grey seconds, then "not clean"', async () => {
  const replay = new SteeringReplay(steeringRecording());
  const startedAt = Date.now();
  const { result: live } = renderHook(() => useLiveCapture(replay));
  await act(async () => {});
  const seen: { atS: number; adjusting: boolean; coaching: string | null; advancing: boolean }[] = [];
  for (let step = 0; step < 190; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    const { coaching } = captureVerdict(live.current);
    seen.push({
      atS: (Date.now() - startedAt) / 1000,
      adjusting: live.current.adjustingExposure,
      coaching,
      advancing: live.current.advancing,
    });
  }
  expect(replay.settledAt).not.toBeNull();
  const settledS = (replay.settledAt! - startedAt) / 1000;
  // The lock is asked for 1 s after the first covered status and takes 3.5 s.
  expect(settledS).toBeGreaterThan(4.4);
  expect(settledS).toBeLessThan(5.2);
  for (const moment of seen) {
    // Batches and statuses land every 100 and 250 ms, so each edge is judged a step away from it.
    if (moment.atS > 1 && moment.atS < settledS - 0.1) expect(moment.adjusting).toBe(true);
    if (moment.atS > settledS + 0.2) expect(moment.adjusting).toBe(false);
    // A stopped count is never silent.
    if (!moment.advancing) expect(moment.coaching).not.toBeNull();
    else expect(moment.coaching).toBeNull();
    // While steering, or within its grey seconds (to 6.2 s), only the brightness line.
    if (!moment.advancing && moment.atS < 6.5) expect(moment.coaching).toBe('coach.brightness');
  }
  expect(seen.some((moment) => moment.coaching === 'coach.brightness')).toBe(true);
  // The 12–13 s frame gap stops the count with no coaching of its own: the plain line.
  const afterGap = seen.filter((moment) => moment.atS > 13 && moment.atS < 18.5 && !moment.advancing);
  expect(afterGap.length).toBeGreaterThan(0);
  for (const moment of afterGap) expect(moment.coaching).toBe('coach.notClean');
});
