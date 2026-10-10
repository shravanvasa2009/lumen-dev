import { Platform } from 'react-native';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { phoneModelOf } from './phoneBackLayouts';
import tokens from '@/theme/tokens.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

const mockProbe: { modelId: string | null; linked: boolean } = { modelId: null, linked: true };
jest.mock('../../modules/lumen-capture/src', () => ({
  get LumenCapture() {
    if (!mockProbe.linked) return null;
    const modelId = mockProbe.modelId;
    return {
      getCapabilities: () =>
        modelId === null ? Promise.reject(new Error('probe failed')) : Promise.resolve({ modelId }),
      requestPermission: () => Promise.resolve({ granted: true }),
    };
  },
}));

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

preloadAppRoutes();

describe('placement', () => {
  const originalOs = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'android';
  });
  afterEach(() => {
    Platform.OS = originalOs;
  });

  it('coaches the finger position with the three tips under the drawing', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    expect(screen.getByText(en['placement.instructionGeneric'])).toBeOnTheScreen();
    for (const key of ['placement.tipCover', 'placement.tipCase', 'placement.tipWipe'] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    expect(screen.getByText(en['placement.subtitle'])).toBeOnTheScreen();
  });

  it('shows the instruction as a highlighted line and the tips as icon rows under a heading', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    expect(screen.getByTestId('placement-instruction')).toHaveStyle({
      backgroundColor: tokens.light.badgeCheckedBg,
    });
    expect(
      within(screen.getByTestId('placement-instruction')).getByText(en['placement.instructionGeneric']),
    ).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: en['placement.tipsHeading'] })).toBeOnTheScreen();
    for (const key of [
      'placement.tipCover',
      'placement.tipCase',
      'placement.tipWipe',
      'placement.tipPosture',
    ] as const)
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    expect(screen.getByText(en['placement.tipWarm'])).toBeOnTheScreen();
  });

  it('starts practice from the pinned button', () => {
    renderRouter('./app', { initialUrl: '/placement' });
    fireEvent.press(screen.getByRole('button', { name: en['placement.start'] }));
    expect(screen.getByRole('header', { name: en['practice.title'] })).toBeOnTheScreen();
  });

  describe('picks the drawing from the phone model', () => {
    const originalModel = (Platform.constants as { Model?: string }).Model;
    afterEach(() => {
      mockProbe.linked = true;
      mockProbe.modelId = null;
      Object.defineProperty(Platform.constants, 'Model', { value: originalModel, configurable: true });
    });

    function setAndroidModel(model: string) {
      Platform.OS = 'android';
      Object.defineProperty(Platform.constants, 'Model', { value: model, configurable: true });
    }

    async function openPlacement() {
      renderRouter('./app', { initialUrl: '/placement' });
      await act(async () => undefined);
    }

    function expectGuide(model: string, instructionKey: keyof typeof en, figureKey: keyof typeof en) {
      expect(screen.getByTestId(`placement-figure-${model}`, { hidden: true })).toBeOnTheScreen();
      expect(screen.getByLabelText(en[figureKey])).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('placement-instruction')).getByText(en[instructionKey]),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('icon-finger', { hidden: true })).toBeOnTheScreen();
    }

    it('draws the Galaxy A17 on a Galaxy A17', async () => {
      setAndroidModel('SM-S176V');
      await openPlacement();
      expectGuide('galaxyA17', 'placement.instructionAndroid', 'placement.figureLabelAndroid');
    });

    it('draws the iPhone 17 Pro on an iPhone 17 Pro', async () => {
      Platform.OS = 'ios';
      mockProbe.modelId = 'iPhone18,1';
      await openPlacement();
      expectGuide('iphone17Pro', 'placement.instructionIos', 'placement.figureLabelIos');
    });

    it.each([
      ['a Pixel', 'android', 'Pixel 9'],
      ['an iPhone 13', 'ios', 'iPhone14,5'],
    ] as const)('draws the generic phone on %s', async (_name, os, model) => {
      if (os === 'android') setAndroidModel(model);
      else {
        Platform.OS = 'ios';
        mockProbe.modelId = model;
      }
      await openPlacement();
      expectGuide('generic', 'placement.instructionGeneric', 'placement.figureLabelGeneric');
      expect(en['placement.instructionGeneric']).toBe(
        'Lay the pad of your finger flat across the main camera lens and the flash.',
      );
    });

    it.each(['unlinked', 'failing'] as const)(
      'keeps the generic phone when the probe is %s',
      async (kind) => {
        Platform.OS = 'ios';
        mockProbe.linked = kind === 'failing';
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        await openPlacement();
        expectGuide('generic', 'placement.instructionGeneric', 'placement.figureLabelGeneric');
        warn.mockRestore();
      },
    );
  });

  it('names only the two supported models', () => {
    expect(phoneModelOf('samsung SM-S176V')).toBe('galaxyA17');
    expect(phoneModelOf('SM-A176B')).toBe('galaxyA17');
    expect(phoneModelOf('iPhone18,1')).toBe('iphone17Pro');
    expect(phoneModelOf('iPhone18,2')).toBe('generic');
    expect(phoneModelOf('iPhone16,2')).toBe('generic');
    expect(phoneModelOf('samsung SM-A175F')).toBe('generic');
  });
});
