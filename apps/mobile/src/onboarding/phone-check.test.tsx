import { renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

import type { Capabilities } from '../../modules/lumen-capture/src';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const mockGetCapabilities = jest.fn<Promise<Capabilities>, []>();
let mockModuleLinked = true;
jest.mock('../../modules/lumen-capture/src', () => ({
  get LumenCapture() {
    return mockModuleLinked ? { getCapabilities: mockGetCapabilities } : null;
  },
}));

const probedPhone: Capabilities = {
  platform: 'android',
  modelId: 'test-phone',
  osVersion: '16',
  rearLenses: [
    { id: 'main', kind: 'wide', maxFps: 60, torchUsable: true },
    { id: 'ultra', kind: 'ultrawide', maxFps: 30, torchUsable: false },
  ],
  torch: { available: true, levels: false },
  locks: { exposure: true, whiteBalance: true, focus: false },
};

// The first render of the router compiles every route, which is slow on a busy machine.
jest.setTimeout(30_000);

describe('phone check', () => {
  beforeEach(() => {
    mockModuleLinked = true;
    mockGetCapabilities.mockReset();
  });

  it('shows what the capability probe reported', async () => {
    mockGetCapabilities.mockResolvedValue(probedPhone);
    renderRouter('./app', { initialUrl: '/phone-check' });
    expect(await screen.findByText('60 fps')).toBeOnTheScreen();
    expect(screen.getByText(en['phoneCheck.torchOnOff'])).toBeOnTheScreen();
    expect(screen.getByText('2 of 3')).toBeOnTheScreen();
    expect(screen.getByText('2')).toBeOnTheScreen();
    expect(screen.getByText(en['phoneCheck.timingLater'])).toBeOnTheScreen();
    expect(screen.queryByText(en['phoneCheck.probeUnavailable'])).not.toBeOnTheScreen();
    // One tick each for frame rate, flashlight and lenses; exposure lock is 2 of 3 and timing is pending.
    expect(screen.root.findAll((node) => String(node.type) === 'RNSVGSvgView')).toHaveLength(3);
  });

  it('shows Checking while the probe is still running', () => {
    mockGetCapabilities.mockReturnValue(new Promise(() => undefined));
    renderRouter('./app', { initialUrl: '/phone-check' });
    expect(screen.getAllByText(en['phoneCheck.checking'])).toHaveLength(5);
    expect(screen.queryByText(en['phoneCheck.notChecked'])).not.toBeOnTheScreen();
  });

  it('marks every row as not checked when the capture module is not linked', () => {
    mockModuleLinked = false;
    renderRouter('./app', { initialUrl: '/phone-check' });
    expect(screen.getAllByText(en['phoneCheck.notChecked'])).toHaveLength(5);
    expect(screen.getByText(en['phoneCheck.probeUnavailable'])).toBeOnTheScreen();
  });

  it('falls back to not checked when the probe fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetCapabilities.mockRejectedValue(new Error('camera busy'));
    renderRouter('./app', { initialUrl: '/phone-check' });
    expect(await screen.findByText(en['phoneCheck.probeUnavailable'])).toBeOnTheScreen();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('camera busy'));
    warn.mockRestore();
  });
});
