import { act, renderHook, waitFor } from '@testing-library/react-native';

import type {
  CameraPermission,
  Capabilities,
  CaptureConfig,
  CaptureStatus,
  LumenCaptureEvents,
  LumenCaptureModule,
  SampleBatch,
} from '../../modules/lumen-capture/src';

import { createLiveSession } from '@lumen/core';

import { keptCapture } from './keptCapture';
import { useLiveCapture } from './useLiveCapture';

jest.mock('@lumen/core', () => {
  const actual = jest.requireActual<typeof import('@lumen/core')>('@lumen/core');
  return { ...actual, createLiveSession: jest.fn(actual.createLiveSession) };
});

const GRANTED: CameraPermission = { status: 'granted', expires: 'never', granted: true, canAskAgain: true };
const DENIED: CameraPermission = { status: 'denied', expires: 'never', granted: false, canAskAgain: false };

const phone: Capabilities = {
  platform: 'android',
  modelId: 'test-phone',
  osVersion: '15',
  rearLenses: [
    { id: 'tele', kind: 'tele', maxFps: 30, torchUsable: true },
    { id: 'ultra', kind: 'ultrawide', maxFps: 60, torchUsable: false },
    { id: 'wide', kind: 'wide', maxFps: 60, torchUsable: true },
  ],
  torch: { available: true, levels: true },
  locks: { exposure: true, whiteBalance: true, focus: true },
};

// A test double for the Appendix A module: it records calls and lets a test emit events.
class FakeCapture implements LumenCaptureModule {
  permission = GRANTED;
  capabilities = phone;
  startError: Error | null = null;
  startGate: Promise<void> | null = null;
  started: CaptureConfig[] = [];
  stops = 0;
  private readonly listeners: { [E in keyof LumenCaptureEvents]: Set<LumenCaptureEvents[E]> } = {
    samples: new Set(),
    status: new Set(),
    lab: new Set(),
  };

  async getCapabilities() {
    return this.capabilities;
  }
  async getPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
  async start(config: CaptureConfig) {
    await this.startGate;
    if (this.startError) throw this.startError;
    this.started.push(config);
    // This fake camera honors any requested rate; with none it runs at 30 fps.
    return { activeFps: config.targetFps ?? 30 };
  }
  async stop() {
    this.stops += 1;
    return { startedNs: 0, stoppedNs: 0, frames: 0, dropped: 0 };
  }
  async setTorch() {}
  async lockExposure() {}
  addListener<E extends keyof LumenCaptureEvents>(e: E, cb: LumenCaptureEvents[E]) {
    this.listeners[e].add(cb);
    return { remove: () => void this.listeners[e].delete(cb) };
  }
  listenerCount(e: keyof LumenCaptureEvents) {
    return this.listeners[e].size;
  }
  emitSamples(batch: SampleBatch) {
    this.listeners.samples.forEach((cb) => cb(batch));
  }
  emitStatus(status: CaptureStatus) {
    this.listeners.status.forEach((cb) => cb(status));
  }
}

const batch = (fromS: number, toS: number, red: number): SampleBatch => ({
  samples: Array.from({ length: Math.round((toS - fromS) * 10) }, (_, i) => ({
    tNs: (fromS + i / 10) * 1e9,
    r: red + i,
    g: 0.1,
    b: 0.1,
  })),
  stats: [],
});

describe('useLiveCapture', () => {
  it('reports unavailable without a capture module', () => {
    const { result: live } = renderHook(() => useLiveCapture(null));
    expect(live.current.phase).toBe('unavailable');
    expect(live.current.cleanSeconds).toBeNull();
    expect(live.current.coachingKey).toBeNull();
  });

  it('starts the wide lens that can light the torch, torch on', async () => {
    const fake = new FakeCapture();
    const { result: live } = renderHook(() => useLiveCapture(fake));
    expect(live.current.phase).toBe('starting');
    await waitFor(() => expect(live.current.phase).toBe('running'));
    expect(fake.started).toEqual([{ lensId: 'wide', targetFps: 60, torchLevel: 1 }]);
  });

  it('asks an iPhone for 120 fps on a 240 fps lens and gives that rate to the session', async () => {
    const fake = new FakeCapture();
    fake.capabilities = {
      ...phone,
      platform: 'ios',
      rearLenses: [{ id: 'wide', kind: 'wide', maxFps: 240, torchUsable: true }],
    };
    const { result: live } = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(live.current.phase).toBe('running'));
    expect(fake.started[0]?.targetFps).toBe(120);
    expect(createLiveSession).toHaveBeenCalledWith(expect.objectContaining({ captureFps: 120 }));
  });

  it('asks for 60 fps on a faster lens and gives that same rate to the session and the kept capture', async () => {
    const fake = new FakeCapture();
    fake.capabilities = {
      ...phone,
      rearLenses: [{ id: 'wide', kind: 'wide', maxFps: 240, torchUsable: true }],
    };
    const { result: live } = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(live.current.phase).toBe('running'));
    expect(fake.started[0]?.targetFps).toBe(60);
    expect(createLiveSession).toHaveBeenCalledWith(expect.objectContaining({ captureFps: 60 }));

    const frames = Array.from({ length: 6 }, (_, i) => 100e9 + (i * 1e9) / 60);
    act(() => {
      fake.emitSamples({
        samples: frames.map((tNs) => ({ tNs, r: 0.7, g: 0.1, b: 0.1 })),
        stats: frames.map((tNs) => ({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 })),
      });
    });
    expect(keptCapture()?.captureFps).toBe(60);
  });

  it('falls back to the first lens with a torch, and to no torch when none has one', async () => {
    const fake = new FakeCapture();
    fake.capabilities = { ...phone, rearLenses: [phone.rearLenses[0]!, phone.rearLenses[1]!] };
    const first = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(first.result.current.phase).toBe('running'));
    expect(fake.started[0]).toEqual({ lensId: 'tele', targetFps: 30, torchLevel: 1 });

    const dark = new FakeCapture();
    dark.capabilities = {
      ...phone,
      rearLenses: [phone.rearLenses[1]!],
      torch: { available: false, levels: false },
    };
    const second = renderHook(() => useLiveCapture(dark));
    await waitFor(() => expect(second.result.current.phase).toBe('running'));
    expect(dark.started[0]).toEqual({ torchLevel: 0 });
  });

  it('exposes the last 6 s of red, the module status, and the frame clock', async () => {
    const fake = new FakeCapture();
    const { result: live } = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(live.current.phase).toBe('running'));
    const status: CaptureStatus = {
      fingerCovered: true,
      motionRms: 0.01,
      thermal: 'nominal',
      fps: 59.5,
      droppedFrac: 0,
    };
    act(() => {
      fake.emitStatus(status);
      fake.emitSamples(batch(100, 104, 0.5));
      fake.emitSamples(batch(104, 108, 0.5));
    });
    expect(live.current.status).toEqual(status);
    expect(live.current.elapsedS).toBeCloseTo(7.9, 6);
    // 6 s at 10 frames per second, inclusive of the edge frame.
    expect(live.current.recentRed).toHaveLength(61);
    expect(live.current.recentRed.at(-1)).toBe(0.5 + 39);
    expect(live.current.cleanSeconds).toBeNull();
    expect(live.current.coachingKey).toBeNull();
  });

  it('reports denied permission without starting the camera', async () => {
    const fake = new FakeCapture();
    fake.permission = DENIED;
    const { result: live } = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(live.current.phase).toBe('denied'));
    expect(fake.started).toEqual([]);
  });

  it('reports a start failure with its reason', async () => {
    const fake = new FakeCapture();
    fake.startError = new Error('camera busy');
    const { result: live } = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(live.current.phase).toBe('failed'));
    expect(live.current.failure).toBe('camera busy');
    expect(fake.listenerCount('samples')).toBe(0);
  });

  it('stops the camera and drops its listeners when the screen goes away', async () => {
    const fake = new FakeCapture();
    const { result: live, unmount } = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(live.current.phase).toBe('running'));
    unmount();
    expect(fake.stops).toBe(1);
    expect(fake.listenerCount('samples')).toBe(0);
    expect(fake.listenerCount('status')).toBe(0);
  });

  it('stops a camera that finished starting after the screen closed', async () => {
    const fake = new FakeCapture();
    let release = () => {};
    fake.startGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { unmount } = renderHook(() => useLiveCapture(fake));
    await waitFor(() => expect(fake.listenerCount('samples')).toBe(1));
    unmount();
    expect(fake.stops).toBe(0);
    release();
    await waitFor(() => expect(fake.stops).toBe(1));
    expect(fake.started).toHaveLength(1);
  });
});
