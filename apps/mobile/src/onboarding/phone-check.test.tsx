import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import type { Capabilities } from '../../modules/lumen-capture/src';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const mockGetCapabilities = jest.fn<Promise<Capabilities>, []>();
const mockRequestPermission = jest.fn(() => Promise.resolve({ granted: true }));
let mockModuleLinked = true;
jest.mock('../../modules/lumen-capture/src', () => ({
  get LumenCapture() {
    return mockModuleLinked
      ? { getCapabilities: mockGetCapabilities, requestPermission: mockRequestPermission }
      : null;
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

preloadAppRoutes();

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
    // 60 fps earns 24 of 30; exposure and white balance lock earn 6 + 5 of the 15 lock points.
    expect(screen.getByText('24/30')).toBeOnTheScreen();
    expect(screen.getByText('11/15')).toBeOnTheScreen();
    expect(screen.getByText('-/20')).toBeOnTheScreen();
    expect(screen.getByText('35')).toBeOnTheScreen();
    expect(
      screen.getByText(en['phoneCheck.progressSettled'].replace('{{done}}', '4').replace('{{total}}', '5')),
    ).toBeOnTheScreen();
    expect(screen.getAllByRole('image', { name: en['phoneCheck.passed'] })).toHaveLength(3);
  });

  it('checks again from the link under Next', async () => {
    mockGetCapabilities.mockResolvedValue(probedPhone);
    renderRouter('./app', { initialUrl: '/phone-check' });
    await screen.findByText('60 fps');
    fireEvent.press(screen.getByRole('button', { name: en['phoneCheck.recheck'] }));
    expect(await screen.findByText('60 fps')).toBeOnTheScreen();
    expect(mockGetCapabilities).toHaveBeenCalledTimes(2);
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

  describe('camera permission', () => {
    afterEach(() => {
      mockRequestPermission.mockReset();
      mockRequestPermission.mockImplementation(() => Promise.resolve({ granted: true }));
    });

    it('asks for the camera before reading capabilities', async () => {
      const calls: string[] = [];
      mockRequestPermission.mockImplementation(() => {
        calls.push('requestPermission');
        return Promise.resolve({ granted: true });
      });
      mockGetCapabilities.mockImplementation(() => {
        calls.push('getCapabilities');
        return Promise.resolve(probedPhone);
      });
      renderRouter('./app', { initialUrl: '/phone-check' });
      expect(await screen.findByText('60 fps')).toBeOnTheScreen();
      expect(calls).toEqual(['requestPermission', 'getCapabilities']);
    });

    it('still finishes the probe when the camera is refused', async () => {
      mockRequestPermission.mockImplementation(() => Promise.resolve({ granted: false }));
      mockGetCapabilities.mockResolvedValue(probedPhone);
      renderRouter('./app', { initialUrl: '/phone-check' });
      expect(await screen.findByText('60 fps')).toBeOnTheScreen();
      expect(screen.getByText('2 of 3')).toBeOnTheScreen();
      expect(screen.queryByText(en['phoneCheck.probeUnavailable'])).not.toBeOnTheScreen();
    });

    it('reports a failed permission request and still finishes the probe', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      mockRequestPermission.mockImplementation(() => Promise.reject(new Error('prompt crashed')));
      mockGetCapabilities.mockResolvedValue(probedPhone);
      renderRouter('./app', { initialUrl: '/phone-check' });
      expect(await screen.findByText('60 fps')).toBeOnTheScreen();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('prompt crashed'));
      warn.mockRestore();
    });
  });
});
