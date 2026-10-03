import type { CaptureStatus, SampleBatch } from './LumenCapture.types';
import { ReplayCapture, type RecordedCapture } from './ReplayCapture';

// SYNTHETIC fixture: an evenly spaced 50 fps timeline (20 ms frames) with made-up colors. It tests
// batching and timing only; it is not a recording and carries no pulse.
const FRAME_NS = 20e6;
const START_NS = 1_000_000_000_000;

function syntheticRecording(frameCount: number, skip: number[] = []): RecordedCapture {
  const tNs = Array.from({ length: frameCount }, (_, i) => START_NS + i * FRAME_NS).filter(
    (_, i) => !skip.includes(i),
  );
  return {
    capabilities: {
      platform: 'ios',
      modelId: 'synthetic-phone',
      osVersion: '0',
      rearLenses: [{ id: 'synthetic-wide', kind: 'wide', maxFps: 50, torchUsable: true }],
      torch: { available: true, levels: true },
      locks: { exposure: true, whiteBalance: true, focus: true },
    },
    samples: { tNs, r: tNs.map(() => 0.6), g: tNs.map(() => 0.1), b: tNs.map(() => 0.1) },
    stats: {
      tNs,
      spatialStdR: tNs.map(() => 0.02),
      clipFrac: tNs.map(() => 0),
      exposureNs: tNs.map(() => 8e6),
    },
  };
}

function record(capture: ReplayCapture) {
  const batches: SampleBatch[] = [];
  const statuses: CaptureStatus[] = [];
  capture.addListener('samples', (batch) => batches.push(batch));
  capture.addListener('status', (status) => statuses.push(status));
  return { batches, statuses };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('emits one batch per 100 ms holding the frames of that window', async () => {
  const capture = new ReplayCapture(syntheticRecording(50));
  const { batches } = record(capture);
  await capture.start({});

  jest.advanceTimersByTime(100);
  expect(batches).toHaveLength(1);
  expect(batches[0]?.samples.map((s) => s.tNs)).toEqual([0, 1, 2, 3, 4].map((i) => START_NS + i * FRAME_NS));
  expect(batches[0]?.stats).toHaveLength(5);

  jest.advanceTimersByTime(100);
  expect(batches[1]?.samples[0]?.tNs).toBe(START_NS + 5 * FRAME_NS);
});

test('start() reports the recording frame rate, whatever targetFps asks for', async () => {
  const capture = new ReplayCapture(syntheticRecording(50, [10]));
  await expect(capture.start({ targetFps: 120 })).resolves.toEqual({ activeFps: 50 });
});

test('emits status at 4 Hz with the frame rate over the last second', async () => {
  const capture = new ReplayCapture(syntheticRecording(200));
  const { statuses } = record(capture);
  await capture.start({});

  jest.advanceTimersByTime(1000);
  expect(statuses).toHaveLength(4);
  expect(statuses.at(-1)?.fps).toBeCloseTo(50, 6);
  expect(statuses.at(-1)?.droppedFrac).toBe(0);
});

test('counts frames missing from gaps longer than 1.5x the median interval (DSP-1)', async () => {
  // Frames 10 and 11 are missing: one 60 ms gap, which hides two 20 ms frames.
  const capture = new ReplayCapture(syntheticRecording(50, [10, 11]));
  const { statuses } = record(capture);
  await capture.start({ lensId: 'synthetic-wide' });

  jest.advanceTimersByTime(2000);
  expect(statuses.at(-1)?.droppedFrac).toBeCloseTo(2 / 50, 9);
  expect(await capture.stop()).toEqual({
    startedNs: START_NS,
    stoppedNs: START_NS + 49 * FRAME_NS,
    lensId: 'synthetic-wide',
    frames: 48,
    dropped: 2,
  });
});

test('stop rejects without a running capture, like the native modules (ADR 0029 Addendum)', async () => {
  const capture = new ReplayCapture(syntheticRecording(10));
  await expect(capture.stop()).rejects.toThrow('stop needs a running capture');
  await capture.start({});
  jest.advanceTimersByTime(5000);
  await expect(capture.stop()).resolves.toMatchObject({ frames: 10 });
  await expect(capture.stop()).rejects.toThrow('stop needs a running capture');
});

test('stops emitting once the recording runs out', async () => {
  const capture = new ReplayCapture(syntheticRecording(10));
  const { batches, statuses } = record(capture);
  await capture.start({});

  jest.advanceTimersByTime(1000);
  const counts = [batches.length, statuses.length];
  jest.advanceTimersByTime(5000);
  expect([batches.length, statuses.length]).toEqual(counts);
  expect(batches.flatMap((batch) => batch.samples)).toHaveLength(10);
});

test('remove() stops delivery to that listener only', async () => {
  const capture = new ReplayCapture(syntheticRecording(50));
  const removed = jest.fn();
  const kept = jest.fn();
  capture.addListener('samples', removed).remove();
  capture.addListener('samples', kept);
  await capture.start({});

  jest.advanceTimersByTime(300);
  expect(removed).not.toHaveBeenCalled();
  expect(kept).toHaveBeenCalledTimes(3);
});

test('reports the camera permission as granted, since a recording needs no camera', async () => {
  const capture = new ReplayCapture(syntheticRecording(10));
  const granted = { status: 'granted', expires: 'never', granted: true, canAskAgain: true };
  expect(await capture.getPermission()).toEqual(granted);
  expect(await capture.requestPermission()).toEqual(granted);
});

test('rejects recordings whose timestamps do not advance', () => {
  const frozen = syntheticRecording(10);
  frozen.samples.tNs = frozen.samples.tNs.map(() => START_NS);
  expect(() => new ReplayCapture(frozen)).toThrow(/median frame interval is 0/);
});

test('rejects recordings whose columns differ in length', () => {
  const broken = syntheticRecording(10);
  broken.samples.r.pop();
  expect(() => new ReplayCapture(broken)).toThrow(/different lengths/);
});
