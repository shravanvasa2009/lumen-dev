import { act, fireEvent, render, screen } from '@testing-library/react-native';

import en from '@/i18n/en.json';
import tokens from '@/theme/tokens.json';

import { ReplayCapture, type RecordedCapture } from '../../modules/lumen-capture/src';

import { LabPanel } from './LabPanel';

import '@/i18n';

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

const realFetch = globalThis.fetch;
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

async function recordWholeReplay() {
  render(<LabPanel capture={new ReplayCapture(syntheticRecording())} />);
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
  render(<LabPanel capture={new ReplayCapture(syntheticRecording())} />);
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

test('keeps Send disabled until a capture is recorded and the receiver is filled in', async () => {
  render(<LabPanel capture={new ReplayCapture(syntheticRecording())} />);
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
