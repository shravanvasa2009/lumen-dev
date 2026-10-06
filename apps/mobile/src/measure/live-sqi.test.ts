import { act, renderHook } from '@testing-library/react-native';

import { ReplayCapture, type RecordedCapture } from '../../modules/lumen-capture/src';

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
