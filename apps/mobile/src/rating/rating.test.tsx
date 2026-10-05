import { type FrameStat, rateDevice, type RatingMeasures, type Sample } from '@lumen/core';
import { screen } from '@testing-library/react-native';
import { act, renderRouter } from 'expo-router/testing-library';
import i18n from 'i18next';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { checkCell, planPhone } from '@/checks/checkPlan';
import en from '@/i18n/en.json';
import { type KeptCapture, keepCapture } from '@/measure/keptCapture';
import { resyncNotifications } from '@/settings/applyPrefs';
import { loadDeviceRating, saveDeviceRating, storedReadingTier } from '@/store/deviceRating';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import type { Capabilities } from '../../modules/lumen-capture/src';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

// Continue opens Reminders, which imports the notification module; it warns outside a development build.
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));

// The launch re-sync waits for the saved language, so it would land in the middle of these tests.
jest.mock('@/i18n/language', () => ({
  ...jest.requireActual('@/i18n/language'),
  useSavedLanguage: jest.fn(),
}));
jest.mock('@/settings/applyPrefs', () => ({
  ...jest.requireActual('@/settings/applyPrefs'),
  resyncNotifications: jest.fn(),
}));

const mockGetCapabilities = jest.fn<Promise<Capabilities>, []>();
let mockModuleLinked = true;
jest.mock('../../modules/lumen-capture/src', () => ({
  get LumenCapture() {
    return mockModuleLinked
      ? {
          getCapabilities: mockGetCapabilities,
          requestPermission: () => Promise.resolve({ granted: true }),
        }
      : null;
  },
}));

jest.setTimeout(30_000);

preloadAppRoutes();

const sixtyFpsPhone: Capabilities = {
  platform: 'ios',
  modelId: 'test-phone',
  osVersion: '26.0',
  rearLenses: [{ id: 'main', kind: 'wide', maxFps: 60, torchUsable: true }],
  torch: { available: true, levels: true },
  locks: { exposure: true, whiteBalance: true, focus: true },
};

const thirtyFpsPhone: Capabilities = {
  ...sixtyFpsPhone,
  rearLenses: [{ id: 'main', kind: 'wide', maxFps: 30, torchUsable: true }],
};

const noFlashPhone: Capabilities = {
  ...sixtyFpsPhone,
  rearLenses: [{ id: 'main', kind: 'wide', maxFps: 60, torchUsable: false }],
  torch: { available: false, levels: false },
};

const lowScorePhone: Capabilities = {
  ...sixtyFpsPhone,
  rearLenses: [{ id: 'main', kind: 'wide', maxFps: 25, torchUsable: true }],
  locks: { exposure: false, whiteBalance: false, focus: false },
};

const noCameraPhone: Capabilities = { ...sixtyFpsPhone, rearLenses: [] };

const FPS = 60;
// DSP-10 reports perfusion only from 30 clean seconds (spec section 6.2), so a practice shorter than that has none.
const SECONDS = 40;

// SYNTHETIC: a steady 72 beats/min pulse of about 3% perfusion on a covered lens, frames exactly 1/60 s apart.
function steadyPulse(lensId: string, seconds = SECONDS): KeptCapture {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (let frame = 0; frame < seconds * FPS; frame += 1) {
    const tNs = 1e12 + (frame * 1e9) / FPS;
    const phase = (2 * Math.PI * 1.2 * frame) / FPS;
    samples.push({ tNs, r: 0.7 - 0.012 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase)), g: 0.1, b: 0.1 });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 });
  }
  return { captureFps: FPS, lensId, samples, stats, motionSpans: [], coldHandsSpans: [], sqi: null };
}

const DETAILS = { testedAt: 1_700_000_000_000, osVersion: '26.0', appVersion: '0.1.0', practice: null };
const PROBE_ONLY: RatingMeasures = {
  lensId: null,
  achievedFps: null,
  frameIntervalSdMs: null,
  coupling: null,
};

// Full credit on coupling and timing, so the score is the frame-rate and lock points plus 55.
function practiceOf(achievedFps: number): RatingMeasures {
  return {
    lensId: 'main',
    achievedFps,
    frameIntervalSdMs: 0.5,
    coupling: { perfusionIndexPct: 1.2, snrDb: 14 },
  };
}

async function storeRating(capabilities: Capabilities, measures: RatingMeasures) {
  const lensId = measures.lensId;
  await saveDeviceRating(rateDevice(capabilities, measures), { ...DETAILS, lensId });
}

beforeEach(() => {
  emptyMockDatabases();
  keepCapture(null);
  mockModuleLinked = true;
  mockGetCapabilities.mockReset();
  jest.mocked(resyncNotifications).mockClear();
});

describe('the rating from the probe and practice', () => {
  it('shows the score and unlocked modes on the rating screen, and stores them', async () => {
    mockGetCapabilities.mockResolvedValue(sixtyFpsPhone);
    keepCapture(steadyPulse('main'));
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();

    // 60 fps level 24 + coupling 35 (PI and SNR past their full-credit marks) + locks 15 + timing 20.
    expect(await screen.findByText('94')).toBeOnTheScreen();
    expect(screen.getByText(en['tier.full'])).toBeOnTheScreen();
    expect(screen.getByText(en['ratingMode.deepHrv'])).toBeOnTheScreen();
    expect(screen.getByText(en['ratingMode.fullScan'])).toBeOnTheScreen();
    expect(screen.getByText(en['rating.checksHere'])).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`${en['checks.diabetes.name']}: ${en['checks.diabetes.what']}`),
    ).toBeOnTheScreen();
    expect(screen.queryByText(en['mode.locked60fps'])).toBeNull();

    const stored = await loadDeviceRating();
    expect(stored).toMatchObject({
      score: 94,
      tier: 'full',
      lensId: 'main',
      osVersion: '26.0',
      ambient: false,
      hardFail: null,
      fpsLevel: 60,
      components: { frameRate: 24, coupling: 35, locks: 15, timing: 20 },
    });
    expect(stored?.practice?.achievedFps).toBeCloseTo(FPS, 3);
    expect(stored?.unlocks).toContain('diabetes');
    expect(resyncNotifications).toHaveBeenCalledTimes(1);
  });

  it('shows the stored rating and its breakdown on Your phone, with no practice capture', async () => {
    await storeRating(sixtyFpsPhone, practiceOf(60));
    renderRouter('./app', { initialUrl: '/settings/phone' });
    expect(await screen.findByText('94')).toBeOnTheScreen();
    expect(screen.getByText(en['tier.full'])).toBeOnTheScreen();
    expect(screen.getByText('24/30')).toBeOnTheScreen();
    expect(screen.getByText('35/35')).toBeOnTheScreen();
    expect(screen.getByText('15/15')).toBeOnTheScreen();
    expect(screen.getByText('20/20')).toBeOnTheScreen();
    expect(screen.queryByText(en['phoneRating.notTested'])).toBeNull();
    expect(screen.getByLabelText('94, Full')).toBeOnTheScreen();
    expect(screen.getAllByTestId('rating-bar')).toHaveLength(4);
    expect(screen.queryByTestId('not-tested-tile')).toBeNull();
  });

  it('writes the perfusion index and the jitter with a decimal comma in Spanish', async () => {
    await saveDeviceRating(rateDevice(sixtyFpsPhone, practiceOf(60)), {
      ...DETAILS,
      lensId: 'main',
      practice: { achievedFps: 60, frameIntervalSdMs: 0.5, perfusionIndexPct: 1.2, snrDb: 14 },
    });
    await act(() => i18n.changeLanguage('es'));
    try {
      renderRouter('./app', { initialUrl: '/settings/phone' });
      expect(await screen.findByText('Índice de perfusión 1,2 %')).toBeOnTheScreen();
      expect(screen.getByText('Variación 0,5 ms')).toBeOnTheScreen();
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
  });

  it('says the phone is not rated yet when neither the probe nor a stored rating gives one', async () => {
    mockModuleLinked = false;
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    expect(await screen.findByText(en['rating.pending'])).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(await loadDeviceRating()).toBeNull();
  });

  it('rates the phone from a practice that just reaches the 30 steady seconds onboarding asks for', async () => {
    mockGetCapabilities.mockResolvedValue(sixtyFpsPhone);
    // H-047 A: the practice passes at 30 steady seconds, DSP-10's minimum for a perfusion index. A capture of
    // exactly 30.0 s analyses to just under 30 clean seconds, so the practice runs a little past its target.
    keepCapture(steadyPulse('main', 31));
    renderRouter('./app', { initialUrl: '/rating' });

    expect(await screen.findByText(en['tier.full'])).toBeOnTheScreen();
    const stored = await loadDeviceRating();
    expect(stored?.components.coupling).not.toBeNull();
    expect(stored?.tier).toBe('full');
  });

  it('leaves the rating open when the practice was too short for a perfusion index', async () => {
    mockGetCapabilities.mockResolvedValue(sixtyFpsPhone);
    keepCapture(steadyPulse('main', 20));
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    expect(await screen.findByText(en['rating.pending'])).toBeOnTheScreen();
    expect(await loadDeviceRating()).toBeNull();
    expect(resyncNotifications).not.toHaveBeenCalled();
  });

  it('leaves the rating open when motion covers most of the practice', async () => {
    mockGetCapabilities.mockResolvedValue(sixtyFpsPhone);
    const shaken = steadyPulse('main');
    const startNs = shaken.samples[0]!.tNs;
    keepCapture({ ...shaken, motionSpans: [{ startNs, endNs: startNs + 35e9 }] });
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    expect(await screen.findByText(en['rating.pending'])).toBeOnTheScreen();
    expect(await loadDeviceRating()).toBeNull();
  });

  it('keeps showing the stored rating when this run fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await storeRating(thirtyFpsPhone, practiceOf(30));
    mockGetCapabilities.mockResolvedValue(thirtyFpsPhone);
    keepCapture(steadyPulse('lens-that-is-not-in-the-probe'));
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    expect(await screen.findByText('84')).toBeOnTheScreen();
    expect(screen.getByText(en['tier.basic'])).toBeOnTheScreen();
    // Basic phones keep AFib and POTS but lock HRV and Diabetes.
    expect(screen.getAllByText(en['mode.locked60fps'])).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not in the probe'));
    warn.mockRestore();
  });

  it('explains a low score on a phone with a working flash and offers Demo mode, with no unlocked list', async () => {
    await storeRating(lowScorePhone, {
      ...practiceOf(25),
      frameIntervalSdMs: 9,
      coupling: { perfusionIndexPct: 1, snrDb: 4 },
    });
    const stored = await loadDeviceRating();
    expect(stored).toMatchObject({ tier: 'unsupported', hardFail: null, ambient: false });
    expect(stored?.score).toBeLessThan(25);
    mockModuleLinked = false;
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    expect(await screen.findByText(en['rating.failScore'])).toBeOnTheScreen();
    expect(screen.getByText(en['rating.demoOffer'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['welcome.tryDemo'] })).toBeOnTheScreen();
    expect(screen.queryByText(en['rating.unlocked'])).toBeNull();
  });

  it('leaves the rating open and stores nothing when the practice found no pulse', async () => {
    mockGetCapabilities.mockResolvedValue(sixtyFpsPhone);
    const flat = steadyPulse('main');
    keepCapture({ ...flat, samples: flat.samples.map((sample) => ({ ...sample, r: 0.7 })) });
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    expect(await screen.findByText(en['rating.pending'])).toBeOnTheScreen();
    expect(await loadDeviceRating()).toBeNull();
  });

  it('explains a phone with no rear camera without waiting for practice', async () => {
    mockGetCapabilities.mockResolvedValue(noCameraPhone);
    renderRouter('./app', { initialUrl: '/rating' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    expect(await screen.findByText(en['rating.failNoCamera'])).toBeOnTheScreen();
    expect(screen.getByText(en['tier.unsupported'])).toBeOnTheScreen();
    expect((await loadDeviceRating())?.tier).toBe('unsupported');
  });
});

describe('reading context tier', () => {
  it('is the stored tier', async () => {
    await storeRating(thirtyFpsPhone, practiceOf(30));
    expect(await storedReadingTier()).toBe('basic');
  });

  it('is null for an unrated phone', async () => {
    expect(await storedReadingTier()).toBeNull();
  });

  it('is null for an unsupported phone, which takes no readings', async () => {
    await storeRating(noCameraPhone, PROBE_ONLY);
    expect((await loadDeviceRating())?.tier).toBe('unsupported');
    expect(await storedReadingTier()).toBeNull();
  });
});

describe('mode picker gating', () => {
  it('leaves every mode open for an unrated phone', async () => {
    renderRouter('./app', { initialUrl: '/measure/mode' });
    expect(await screen.findByRole('button', { name: en['mode.full'] })).toBeEnabled();
    expect(screen.queryByText(en['mode.lockedBasic'])).toBeNull();
    expect(screen.queryByText(/rating \(/)).toBeNull();
  });

  it('keeps Basic phones off Deep HRV with the 60 fps reason, and shows the tier', async () => {
    await storeRating(thirtyFpsPhone, practiceOf(30));
    renderRouter('./app', { initialUrl: '/measure/mode' });
    expect(await screen.findByText(en['mode.locked60fps'])).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['mode.deep'] })).toBeDisabled();
    expect(screen.getByRole('button', { name: en['mode.full'] })).toBeEnabled();
    expect(screen.getByRole('button', { name: en['mode.standing'] })).toBeEnabled();
    // 30 fps level 14 + coupling 35 + locks 15 + timing 20.
    expect(screen.getByText('Basic rating (84)')).toBeOnTheScreen();
    // Screen readers hear why the card is locked.
    expect(screen.getByRole('button', { name: en['mode.deep'] }).props.accessibilityHint).toBe(
      en['mode.locked60fps'],
    );
  });

  it('gives a Basic phone that films at 60 fps the tier reason for Deep HRV, not the frame rate', async () => {
    await storeRating(
      { ...sixtyFpsPhone, locks: { exposure: false, whiteBalance: false, focus: false } },
      { ...practiceOf(60), frameIntervalSdMs: 4, coupling: { perfusionIndexPct: 0.8, snrDb: 9 } },
    );
    expect((await loadDeviceRating())?.tier).toBe('basic');
    renderRouter('./app', { initialUrl: '/measure/mode' });
    expect(await screen.findByText(en['mode.lockedFull'])).toBeOnTheScreen();
    expect(screen.queryByText(en['mode.locked60fps'])).toBeNull();
  });

  it('gives every locked check on a flash-less Limited phone the flash reason', async () => {
    await storeRating(noFlashPhone, { ...practiceOf(60), coupling: { perfusionIndexPct: 0.2, snrDb: 7 } });
    expect((await loadDeviceRating())?.tier).toBe('limited');
    renderRouter('./app', { initialUrl: '/rating' });
    for (const name of [
      'checks.hrv.name',
      'checks.diabetes.name',
      'checks.pots.name',
      'checks.afib.name',
    ] as const) {
      expect(await screen.findByLabelText(`${en[name]}: ${en['mode.lockedFlash']}`)).toBeOnTheScreen();
    }
  });

  it('opens POTS on a Basic phone and gives HRV and Diabetes the 60 fps reason', async () => {
    await storeRating(thirtyFpsPhone, practiceOf(30));
    renderRouter('./app', { initialUrl: '/rating' });
    expect(
      await screen.findByLabelText(`${en['checks.pots.name']}: ${en['checks.pots.whatShort']}`),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(`${en['checks.afib.name']}: ${en['checks.afib.what']}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${en['checks.hrv.name']}: ${en['mode.locked60fps']}`)).toBeOnTheScreen();
  });

  it('gives a flash-less Limited phone the flash reason on every locked mode', async () => {
    await storeRating(noFlashPhone, { ...practiceOf(60), coupling: { perfusionIndexPct: 0.2, snrDb: 7 } });
    renderRouter('./app', { initialUrl: '/measure/mode' });
    expect(await screen.findAllByText(en['mode.lockedFlash'])).toHaveLength(3);
  });

  it('shows a flash-less phone at 30 fps the same reason as the checks table (flash, not the frame rate)', async () => {
    const slowNoFlash: Capabilities = {
      ...noFlashPhone,
      rearLenses: [{ id: 'main', kind: 'wide', maxFps: 30, torchUsable: false }],
    };
    await storeRating(slowNoFlash, { ...practiceOf(30), coupling: { perfusionIndexPct: 0.2, snrDb: 7 } });
    const stored = await loadDeviceRating();
    expect(stored?.ambient).toBe(true);
    const cell = checkCell('deep', 'hrv', planPhone(stored));
    expect(cell).toEqual({ state: 'locked', why: 'flash' });
    renderRouter('./app', { initialUrl: '/measure/mode' });
    expect(await screen.findAllByText(en['mode.lockedFlash'])).toHaveLength(3);
    expect(screen.queryByText(en['mode.locked60fps'])).toBeNull();
  });

  it('leaves a flash-less Limited phone with Quick Check only, and still lists the other modes', async () => {
    await storeRating(noFlashPhone, {
      ...practiceOf(60),
      coupling: { perfusionIndexPct: 0.2, snrDb: 7 },
    });
    expect((await loadDeviceRating())?.tier).toBe('limited');
    renderRouter('./app', { initialUrl: '/measure/mode' });
    expect(await screen.findAllByText(en['mode.lockedFlash'])).toHaveLength(3);
    for (const key of ['mode.full', 'mode.deep', 'mode.standing'] as const)
      expect(screen.getByRole('button', { name: en[key] })).toBeDisabled();
    expect(screen.getByRole('button', { name: en['mode.quick'] })).toBeEnabled();
  });

  it('locks every mode on an unsupported phone', async () => {
    await storeRating(noCameraPhone, PROBE_ONLY);
    renderRouter('./app', { initialUrl: '/measure/mode' });
    expect(await screen.findAllByText(en['mode.lockedUnsupported'])).toHaveLength(4);
  });
});

describe('Settings row', () => {
  it('names the tier and score once rated', async () => {
    await storeRating(sixtyFpsPhone, practiceOf(60));
    renderRouter('./app', { initialUrl: '/settings' });
    expect(await screen.findByText('Full (94)')).toBeOnTheScreen();
  });

  it('shows no tested state until the stored rating has loaded', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    expect(screen.queryByText(en['settings.phoneNotTested'])).toBeNull();
    expect(await screen.findByText(en['settings.phoneNotTested'])).toBeOnTheScreen();
  });
});
