import { act, fireEvent, render, screen } from '@testing-library/react-native';

import en from '@/i18n/en.json';
import tokens from '@/theme/tokens.json';

import { ReplayCapture, type LabDiagnostics, type RecordedCapture } from '../../modules/lumen-capture/src';

import { LabPanel } from './LabPanel';
import type { StrapEvents } from './polarStrap';

import '@/i18n';

// The Bluetooth side is tested in polarStrap.test.ts; here a fake strap hands the panel its events.
let mockStrapEvents: StrapEvents | undefined;
const mockStrapDisconnect = jest.fn(async () => undefined);
jest.mock('./polarStrap', () => ({
  connectStrap: jest.fn(async (strapEvents: StrapEvents) => {
    mockStrapEvents = strapEvents;
    return { name: 'Polar H10 SYNTHETIC', disconnect: mockStrapDisconnect };
  }),
}));

let mockScheme: 'light' | 'dark' = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

// SYNTHETIC fixture: 100 evenly spaced 50 fps frames with a slow ramp in red. It drives the panel's
// plumbing only; it is not a recording and carries no pulse.
const FRAME_NS = 20e6;
function syntheticRecording(): RecordedCapture {
  const tNs = Array.from({ length: 100 }, (_, i) => 1e12 + i * FRAME_NS);
  return {
    capabilities: {
      platform: 'android',
      modelId: 'synthetic-phone',
      osVersion: '0',
      rearLenses: [{ id: 'synthetic-wide', kind: 'wide', maxFps: 50, torchUsable: true }],
      torch: { available: true, levels: true },
      locks: { exposure: true, whiteBalance: true, focus: true },
    },
    samples: { tNs, r: tNs.map((_, i) => 0.6 + i * 1e-4), g: tNs.map(() => 0.1), b: tNs.map(() => 0.1) },
    stats: {
      tNs,
      spatialStdR: tNs.map(() => 0.02),
      clipFrac: tNs.map(() => 0),
      exposureNs: tNs.map(() => 8e6),
    },
  };
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: label }));
  });
};

// react-native loads its components lazily, so the first full render in a test process loads and
// Babel-transforms TextInput, Pressable, and the Fabric renderer. Measured on the owner's 28-thread
// PC with a cold Jest cache and the whole mobile suite running in parallel: 4.3-6.1 s in the first
// test that starts a capture (past Jest's 5 s default) and 4.5-5.5 s in this hook; under 0.4 s once
// loaded. One render here pays that cost with room to spare, so each test's 5 s is for its own work.
const COLD_RENDER_MS = 30_000;
beforeAll(async () => {
  const { unmount } = render(<LabPanel capture={new ReplayCapture(syntheticRecording())} />);
  // Lets getCapabilities() resolve so the lens and torch options render too.
  await act(async () => {});
  unmount();
}, COLD_RENDER_MS);

const realFetch = globalThis.fetch;
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

async function recordWholeReplay() {
  await renderWithPhone(new ReplayCapture(syntheticRecording()));
  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(2500);
  });
  await press(en['lab.stop']);
}

function typeReceiver(address: string, token: string) {
  fireEvent.changeText(screen.getByLabelText(en['lab.address']), address);
  fireEvent.changeText(screen.getByLabelText(en['lab.token']), token);
}

test('says so when the build has neither the camera module nor a recording', () => {
  render(<LabPanel capture={null} />);
  expect(screen.getByText(en['lab.noSource'])).toBeOnTheScreen();
});

test('drives a ReplayCapture: permission, live trace, status, and frame count', async () => {
  await renderWithPhone(new ReplayCapture(syntheticRecording()));
  expect(screen.getByText(en['lab.sourceReplay'])).toBeOnTheScreen();

  await press(en['lab.askPermission']);
  expect(screen.getByText(en['lab.permissionGranted'])).toBeOnTheScreen();

  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByText(fill(en['lab.status'], { fps: '50.0', dropped: '0.00' }))).toBeOnTheScreen();
  expect(screen.getByText(fill(en['lab.frames'], { frames: 50 }))).toBeOnTheScreen();
  expect(screen.getByTestId('lab-red-trace').children).toHaveLength(50);
  // Recordings carry no native diagnostics.
  expect(screen.getByText(en['lab.noDiagnostics'])).toBeOnTheScreen();

  await press(en['lab.stop']);
  expect(screen.getByRole('button', { name: en['lab.start'] })).toBeOnTheScreen();
});

test('sends the recorded capture and shows the folder the receiver created', async () => {
  const fetchMock = jest.fn(
    async (_url: string, _init: { body: string }) =>
      ({
        status: 201,
        text: async () => JSON.stringify({ folder: '20261004-153012-syntheticphone' }),
      }) as Response,
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await recordWholeReplay();
  typeReceiver('10.0.2.2:8787', 'abc123');
  await press(en['lab.send']);

  expect(
    screen.getByText(fill(en['lab.sent'], { folder: '20261004-153012-syntheticphone' })),
  ).toBeOnTheScreen();
  const sent = JSON.parse(fetchMock.mock.calls[0]?.[1].body ?? '{}');
  expect(sent.meta).toMatchObject({ platform: 'android', modelId: 'synthetic-phone', mode: 'full' });
  expect(sent.meta.lensId).toBe('synthetic-wide');
  expect(sent.samples.tNs).toHaveLength(100);
  expect(sent.stats.exposureNs).toHaveLength(100);
});

test('shows the receiver error when the capture is not accepted', async () => {
  globalThis.fetch = jest.fn(
    async () => ({ status: 401, text: async () => 'bad token' }) as Response,
  ) as unknown as typeof fetch;
  await recordWholeReplay();
  typeReceiver('10.0.2.2:8787', 'wrong');
  await press(en['lab.send']);

  expect(
    screen.getByText(fill(en['lab.sendFailed'], { reason: 'receiver answered 401: bad token' })),
  ).toBeOnTheScreen();
});

test('a second Start press while the first is pending does not record every frame twice', async () => {
  const fetchMock = jest.fn(
    async (_url: string, _init: { body: string }) =>
      ({ status: 201, text: async () => JSON.stringify({ folder: 'f' }) }) as Response,
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderWithPhone(new ReplayCapture(syntheticRecording()));
  await act(async () => {
    const start = screen.getByRole('button', { name: en['lab.start'] });
    fireEvent.press(start);
    fireEvent.press(start);
  });
  await act(async () => {
    jest.advanceTimersByTime(2500);
  });
  expect(screen.getByText(fill(en['lab.frames'], { frames: 100 }))).toBeOnTheScreen();

  await press(en['lab.stop']);
  typeReceiver('10.0.2.2:8787', 'abc123');
  await press(en['lab.send']);
  const sent = JSON.parse(fetchMock.mock.calls[0]?.[1].body ?? '{}');
  expect(sent.samples.tNs).toEqual(syntheticRecording().samples.tNs);
});

test('stops the camera if the screen closes while start() is pending, and reports a failed stop', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  let finishStart: () => void = () => undefined;
  jest.spyOn(replay, 'start').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishStart = resolve;
      }),
  );
  const stop = jest.spyOn(replay, 'stop').mockRejectedValue(new Error('camera busy'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { unmount } = render(<LabPanel capture={replay} />);
  await act(async () => undefined);

  await press(en['lab.start']);
  expect(screen.getByRole('button', { name: en['lab.start'] })).toBeDisabled();
  unmount();
  await act(async () => {
    finishStart();
  });

  expect(stop).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith('Lab capture did not stop: camera busy');
  warn.mockRestore();
});

test('shows the thermal state from the status event', async () => {
  await renderWithPhone(new ReplayCapture(syntheticRecording()));
  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(screen.getByText(en['lab.thermalNominal'])).toBeOnTheScreen();
});

test('keeps Send disabled until a capture is recorded and the receiver is filled in', async () => {
  await renderWithPhone(new ReplayCapture(syntheticRecording()));
  typeReceiver('10.0.2.2:8787', 'abc123');
  expect(screen.getByRole('button', { name: en['lab.send'] })).toBeDisabled();
});

test.each([
  ['dark', tokens.dark],
  ['light', tokens.light],
] as const)(
  'uses no red in the %s theme (SAFE-1 reserves it for the emergency screen)',
  async (scheme, colors) => {
    mockScheme = scheme;
    await recordWholeReplay();
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn).not.toContain(colors.criticalFill);
    expect(drawn).not.toContain(colors.criticalText);
    expect(drawn).not.toContain(colors.pulse);
  },
);

async function renderWithPhone(replay: ReplayCapture) {
  render(<LabPanel capture={replay} />);
  // Lets the capabilities request resolve so the lens and torch choices appear.
  await act(async () => undefined);
}

const lensLabel = fill(en['lab.lensOption'], { kind: en['lab.lensWide'], id: 'synthetic-wide', fps: 50 });

test('starts with the chosen lens, target fps, and torch level', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const start = jest.spyOn(replay, 'start');
  await renderWithPhone(replay);
  expect(screen.getByText(fill(en['lab.phone'], { model: 'synthetic-phone', os: '0' }))).toBeOnTheScreen();

  await press(lensLabel);
  await press(fill(en['lab.fpsTarget'], { fps: 60 }));
  await press(fill(en['lab.torchLevel'], { level: 0.5 }));
  await press(en['lab.start']);

  expect(start).toHaveBeenCalledWith({ lensId: 'synthetic-wide', targetFps: 60, torchLevel: 0.5 });
});

test('the default start leaves lens and fps to native and turns the torch on full', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const start = jest.spyOn(replay, 'start');
  await renderWithPhone(replay);
  await press(en['lab.start']);
  expect(start).toHaveBeenCalledWith({ torchLevel: 1 });
});

test('locks exposure 1 s after start by default and says when the lock finished', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const lock = jest.spyOn(replay, 'lockExposure');
  await renderWithPhone(replay);
  await press(en['lab.start']);

  await act(async () => {
    jest.advanceTimersByTime(999);
  });
  expect(lock).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(lock).toHaveBeenCalledTimes(1);
  expect(screen.getByText(en['lab.lockDone'])).toBeOnTheScreen();
});

test('with auto-lock off, only the Lock exposure button locks', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const lock = jest.spyOn(replay, 'lockExposure');
  await renderWithPhone(replay);
  await press(en['lab.autoLockOn']);
  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(lock).not.toHaveBeenCalled();

  await press(en['lab.lockExposure']);
  expect(lock).toHaveBeenCalledTimes(1);
});

test('stopping before 1 s cancels the auto-lock', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const lock = jest.spyOn(replay, 'lockExposure');
  await renderWithPhone(replay);
  await press(en['lab.start']);
  await press(en['lab.stop']);
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(lock).not.toHaveBeenCalled();
});

test('shows why a lock failed', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  jest.spyOn(replay, 'lockExposure').mockRejectedValue(new Error('No capture is running'));
  await renderWithPhone(replay);
  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByText(fill(en['lab.failed'], { reason: 'No capture is running' }))).toBeOnTheScreen();
  expect(screen.queryByText(en['lab.lockDone'])).toBeNull();
});

test('changes the torch on the running capture, but only stores the level before start', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const setTorch = jest.spyOn(replay, 'setTorch');
  await renderWithPhone(replay);
  await press(fill(en['lab.torchLevel'], { level: 0.25 }));
  expect(setTorch).not.toHaveBeenCalled();

  await press(en['lab.start']);
  await press(en['lab.torchOff']);
  expect(setTorch).toHaveBeenCalledWith(0);
});

test('locks the lens, fps, and auto-lock choices while running, and Lock exposure while stopped', async () => {
  await renderWithPhone(new ReplayCapture(syntheticRecording()));
  const button = (label: string) => screen.getByRole('button', { name: label });
  expect(button(en['lab.lockExposure'])).toBeDisabled();
  expect(button(lensLabel)).toBeEnabled();

  await press(en['lab.start']);
  expect(button(lensLabel)).toBeDisabled();
  expect(button(en['lab.lensDefault'])).toBeDisabled();
  expect(button(en['lab.fpsDefault'])).toBeDisabled();
  expect(button(en['lab.autoLockOn'])).toBeDisabled();
  expect(button(en['lab.torchOff'])).toBeEnabled();
  expect(button(en['lab.lockExposure'])).toBeEnabled();
});

test('offers only on and off when the torch has no levels, and marks a lens without a torch', async () => {
  const recording = syntheticRecording();
  recording.capabilities = {
    ...recording.capabilities,
    rearLenses: [
      ...recording.capabilities.rearLenses,
      { id: 'synthetic-ultra', kind: 'ultrawide', maxFps: 30, torchUsable: false },
    ],
    torch: { available: true, levels: false },
  };
  const replay = new ReplayCapture(recording);
  const start = jest.spyOn(replay, 'start');
  await renderWithPhone(replay);
  expect(
    screen.getByText(
      fill(en['lab.lensOptionNoTorch'], { kind: en['lab.lensUltrawide'], id: 'synthetic-ultra', fps: 30 }),
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByText(fill(en['lab.torchLevel'], { level: 0.5 }))).toBeNull();

  await press(en['lab.torchOff']);
  await press(en['lab.torchOn']);
  await press(en['lab.start']);
  expect(start).toHaveBeenCalledWith({ torchLevel: 1 });
});

test('shows the lens, format, and target fps native reports in the lab event', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const listen = jest.spyOn(replay, 'addListener');
  await renderWithPhone(replay);
  await press(en['lab.start']);
  const onLab = listen.mock.calls.find(([event]) => event === 'lab')?.[1] as (d: LabDiagnostics) => void;
  await act(async () => {
    onLab({
      lensId: 'synthetic-wide',
      formatWidth: 1920,
      formatHeight: 1080,
      targetFps: 60,
      frameWorkMsMean: 1.2,
      frameWorkMsMax: 3.4,
      iso: 50,
      exposureNs: 8e6,
      torchOn: true,
      torchLevel: 0.5,
      locked: { exposure: true, whiteBalance: true, focus: true },
    });
  });
  expect(
    screen.getByText(
      fill(en['lab.diagFormat'], { lens: 'synthetic-wide', width: 1920, height: 1080, fps: 60 }),
    ),
  ).toBeOnTheScreen();
});

function withUltrawideWithoutTorch(): RecordedCapture {
  const recording = syntheticRecording();
  recording.capabilities = {
    ...recording.capabilities,
    rearLenses: [
      ...recording.capabilities.rearLenses,
      { id: 'synthetic-ultra', kind: 'ultrawide', maxFps: 240, torchUsable: false },
    ],
  };
  return recording;
}

const ultraLabel = fill(en['lab.lensOptionNoTorch'], {
  kind: en['lab.lensUltrawide'],
  id: 'synthetic-ultra',
  fps: 240,
});

test('marks the chosen options as selected, starting from the defaults', async () => {
  await renderWithPhone(new ReplayCapture(syntheticRecording()));
  const button = (label: string) => screen.getByRole('button', { name: label });
  expect(button(en['lab.lensDefault'])).toBeSelected();
  expect(button(en['lab.fpsDefault'])).toBeSelected();
  expect(button(fill(en['lab.torchLevel'], { level: 1 }))).toBeSelected();
  expect(button(lensLabel)).not.toBeSelected();

  await press(lensLabel);
  expect(button(lensLabel)).toBeSelected();
  expect(button(en['lab.lensDefault'])).not.toBeSelected();
});

test('offers the picked lens maximum only once a lens is picked, and sends it as targetFps', async () => {
  const replay = new ReplayCapture(withUltrawideWithoutTorch());
  const start = jest.spyOn(replay, 'start');
  await renderWithPhone(replay);
  const lensMax = fill(en['lab.fpsLensMax'], { fps: 240 });
  expect(screen.queryByRole('button', { name: lensMax })).toBeNull();

  await press(ultraLabel);
  await press(lensMax);
  await press(en['lab.start']);
  expect(start).toHaveBeenCalledWith({ lensId: 'synthetic-ultra', targetFps: 240, torchLevel: 0 });
});

test('going back to the default lens drops the lens-max choice', async () => {
  const replay = new ReplayCapture(withUltrawideWithoutTorch());
  const start = jest.spyOn(replay, 'start');
  await renderWithPhone(replay);
  await press(lensLabel);
  await press(fill(en['lab.fpsLensMax'], { fps: 50 }));
  await press(en['lab.lensDefault']);

  expect(screen.queryByRole('button', { name: fill(en['lab.fpsLensMax'], { fps: 50 }) })).toBeNull();
  expect(screen.getByRole('button', { name: en['lab.fpsDefault'] })).toBeSelected();
  await press(en['lab.start']);
  expect(start).toHaveBeenCalledWith({ torchLevel: 1 });
});

test('picking a lens without a torch turns the torch choice off, so start() is not rejected', async () => {
  const replay = new ReplayCapture(withUltrawideWithoutTorch());
  const start = jest.spyOn(replay, 'start');
  await renderWithPhone(replay);
  await press(ultraLabel);
  expect(screen.getByRole('button', { name: en['lab.torchOff'] })).toBeSelected();
  await press(en['lab.start']);
  expect(start).toHaveBeenCalledWith({ lensId: 'synthetic-ultra', torchLevel: 0 });
});

test('a manual lock before 1 s replaces the auto-lock instead of locking twice', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  const lock = jest.spyOn(replay, 'lockExposure');
  await renderWithPhone(replay);
  await press(en['lab.start']);
  await press(en['lab.lockExposure']);
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(lock).toHaveBeenCalledTimes(1);
});

test('a new lock clears the previous error', async () => {
  const replay = new ReplayCapture(syntheticRecording());
  jest
    .spyOn(replay, 'lockExposure')
    .mockRejectedValueOnce(new Error('Exposure did not settle'))
    .mockResolvedValue(undefined);
  await renderWithPhone(replay);
  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  const failed = fill(en['lab.failed'], { reason: 'Exposure did not settle' });
  expect(screen.getByText(failed)).toBeOnTheScreen();

  await press(en['lab.lockExposure']);
  expect(screen.queryByText(failed)).toBeNull();
  expect(screen.getByText(en['lab.lockDone'])).toBeOnTheScreen();
});

// SYNTHETIC: 12 s of a clean 1.2 Hz (72 bpm) sine in red at 30 fps, long enough for core's 8 s segment.
function pulseRecording(): RecordedCapture {
  const recording = syntheticRecording();
  const tNs = Array.from({ length: 360 }, (_, i) => 1e12 + (i * 1e9) / 30);
  recording.samples = {
    tNs,
    r: tNs.map((_, i) => 0.6 + 0.01 * Math.sin(2 * Math.PI * 1.2 * (i / 30))),
    g: tNs.map(() => 0.1),
    b: tNs.map(() => 0.1),
  };
  delete recording.stats;
  return recording;
}

async function playFor(recording: RecordedCapture, ms: number) {
  await renderWithPhone(new ReplayCapture(recording));
  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

test('shows the live heart rate and SNR from @lumen/core once 10 s of pulse have arrived', async () => {
  await playFor(pulseRecording(), 12500);
  expect(screen.getByText(/^Live heart rate \(Lab only\): 72 bpm · SNR \d+\.\d dB$/)).toBeOnTheScreen();
});

test('shows a dash while core has no estimate', async () => {
  // 2.5 s of pulse: core runs on a window shorter than its 8 s segment and returns no estimate.
  await playFor(pulseRecording(), 2500);
  expect(screen.getByText(en['lab.liveHrNone'])).toBeOnTheScreen();
});

test('drops the old bpm when the clock steps back more than 1 s', async () => {
  const recording = pulseRecording();
  const { tNs, r, g, b } = recording.samples;
  const steppedNs = Array.from({ length: 30 }, (_, i) => 1e12 - 20e9 + (i * 1e9) / 30);
  recording.samples = {
    tNs: [...tNs, ...steppedNs],
    r: [...r, ...steppedNs.map(() => 0.6)],
    g: [...g, ...steppedNs.map(() => 0.1)],
    b: [...b, ...steppedNs.map(() => 0.1)],
  };
  await playFor(recording, 11900);
  expect(screen.getByText(/^Live heart rate \(Lab only\): 72 bpm/)).toBeOnTheScreen();

  await act(async () => {
    jest.advanceTimersByTime(600);
  });
  expect(screen.getByText(en['lab.liveHrNone'])).toBeOnTheScreen();
});

test('shows the RangeError for repeated timestamps instead of a number', async () => {
  const recording = pulseRecording();
  recording.samples.tNs[300] = recording.samples.tNs[299]!;
  await playFor(recording, 12500);
  expect(screen.getByText(en['lab.liveHrNone'])).toBeOnTheScreen();
  expect(screen.getByText(new RegExp(`^${en['lab.liveHrError'].split('{{')[0]}`))).toBeOnTheScreen();
});

test('keeps Start disabled until the phone capabilities arrive, so a torchless phone is not sent level 1', async () => {
  const recording = syntheticRecording();
  recording.capabilities = { ...recording.capabilities, torch: { available: false, levels: false } };
  const replay = new ReplayCapture(recording);
  const start = jest.spyOn(replay, 'start');
  render(<LabPanel capture={replay} />);
  expect(screen.getByRole('button', { name: en['lab.start'] })).toBeDisabled();

  await act(async () => undefined);
  await press(en['lab.start']);
  expect(start).toHaveBeenCalledWith({ torchLevel: 0 });
});

test('with no torch on the phone, the torch starts Off and only Off can be chosen (ADR 0029)', async () => {
  const recording = syntheticRecording();
  recording.capabilities = {
    ...recording.capabilities,
    rearLenses: [{ id: 'synthetic-wide', kind: 'wide', maxFps: 50, torchUsable: false }],
    torch: { available: false, levels: false },
  };
  const replay = new ReplayCapture(recording);
  const start = jest.spyOn(replay, 'start');
  await renderWithPhone(replay);
  expect(screen.getByRole('button', { name: en['lab.torchOff'] })).toBeSelected();
  expect(screen.getByRole('button', { name: en['lab.torchOn'] })).toBeDisabled();

  await press(en['lab.start']);
  expect(start).toHaveBeenCalledWith({ torchLevel: 0 });
});

test('a lens without a torch disables every torch choice but Off until another lens is picked', async () => {
  await renderWithPhone(new ReplayCapture(withUltrawideWithoutTorch()));
  const level = (value: number) =>
    screen.getByRole('button', { name: fill(en['lab.torchLevel'], { level: value }) });
  await press(ultraLabel);
  expect(level(1)).toBeDisabled();
  expect(level(0.25)).toBeDisabled();
  expect(screen.getByRole('button', { name: en['lab.torchOff'] })).toBeEnabled();

  await press(en['lab.lensDefault']);
  expect(level(1)).toBeEnabled();
});

test('records strap RR during a capture and sends it as polarRr on the camera clock', async () => {
  const fetchMock = jest.fn(
    async (_url: string, _init: { body: string }) =>
      ({ status: 201, text: async () => JSON.stringify({ folder: 'f' }) }) as Response,
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const { unmount } = render(<LabPanel capture={new ReplayCapture(syntheticRecording())} />);
  await act(async () => undefined);
  await press(en['lab.strapConnect']);
  expect(screen.getByText(fill(en['lab.strapConnected'], { name: 'Polar H10 SYNTHETIC' }))).toBeOnTheScreen();

  await press(en['lab.start']);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  // SYNTHETIC strap packet: one RR interval of 833 ms.
  act(() => mockStrapEvents?.onMeasurement({ bpm: 72, contact: 'detected', rrMs: [833] }));
  expect(screen.getByText(fill(en['lab.strapHr'], { bpm: 72 }))).toBeOnTheScreen();
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  await press(en['lab.stop']);
  expect(screen.getByText(fill(en['lab.strapRecorded'], { count: 1 }))).toBeOnTheScreen();

  typeReceiver('10.0.2.2:8787', 'abc123');
  await press(en['lab.send']);
  const sent = JSON.parse(fetchMock.mock.calls[0]?.[1].body ?? '{}');
  const frameTimes = syntheticRecording().samples.tNs;
  expect(sent.polarRr.rrMs).toEqual([833]);
  expect(sent.polarRr.tNs).toHaveLength(1);
  expect(sent.polarRr.tNs[0]).toBeGreaterThanOrEqual(frameTimes[0]!);
  expect(sent.polarRr.tNs[0]).toBeLessThanOrEqual(frameTimes[frameTimes.length - 1]!);

  unmount();
  expect(mockStrapDisconnect).toHaveBeenCalled();
});

test('a capture without a strap sends no polarRr', async () => {
  const fetchMock = jest.fn(
    async (_url: string, _init: { body: string }) =>
      ({ status: 201, text: async () => JSON.stringify({ folder: 'f' }) }) as Response,
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await recordWholeReplay();
  typeReceiver('10.0.2.2:8787', 'abc123');
  await press(en['lab.send']);
  expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body ?? '{}')).not.toHaveProperty('polarRr');
});
