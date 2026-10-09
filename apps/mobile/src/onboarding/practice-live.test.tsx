import * as Linking from 'expo-linking';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import type { LiveCapture } from '@/measure/useLiveCapture';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

jest.mock('expo-linking', () => ({
  ...jest.requireActual<typeof import('expo-linking')>('expo-linking'),
  openSettings: jest.fn(),
}));

const mockRatePhone = jest.fn();
jest.mock('@/rating/ratePhone', () => ({ ratePhone: (...args: unknown[]) => mockRatePhone(...args) }));
// One object, as the real hook's state is, so the rating effect does not rerun on every render.
jest.mock('@/onboarding/usePhoneProbe', () => {
  const probe = { kind: 'ready', capabilities: { platform: 'android' } };
  return { usePhoneProbe: () => probe };
});

jest.mock('../../modules/lumen-capture/src/LumenPreviewView', () => ({
  LumenPreviewView: jest.requireActual('react-native').View,
}));

let mockLive: LiveCapture;
jest.mock('@/measure/useLiveCapture', () => ({ useLiveCapture: () => mockLive }));

const running: LiveCapture = {
  phase: 'running',
  failure: null,
  status: { fingerCovered: true, motionRms: 0, thermal: 'nominal', fps: 60, droppedFrac: 0 },
  recentRed: [0.6, 0.62, 0.58, 0.61],
  recentPulse: [0.1, 0.4, -0.1, 0.2],
  elapsedS: 5,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
  signalLevel: null,
  nativeCamera: false,
  advancing: false,
  adjustingExposure: false,
};

jest.setTimeout(30_000);

preloadAppRoutes();

describe('practice with a running capture', () => {
  it('draws the pulse, drops the cover coaching and waits for a clean signal', () => {
    mockLive = running;
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByTestId('live-waveform', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(en['coach.cover'])).toBeNull();
    expect(screen.getByText(en['capture.waiting'])).toBeOnTheScreen();
    expect(screen.getByText('0 of 30 steady seconds')).toBeOnTheScreen();
  });

  it('coaches to cover the lens when the module reports no finger', () => {
    mockLive = { ...running, status: { ...running.status!, fingerCovered: false } };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByText(en['coach.cover'])).toBeOnTheScreen();
  });

  it('shows the steady seconds and the coaching key a session supplies', () => {
    mockLive = { ...running, cleanSeconds: 9.6, coachingKey: 'coach.still' };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByText('9 of 30 steady seconds')).toBeOnTheScreen();
    expect(screen.getByText(en['coach.still'])).toBeOnTheScreen();
  });
  it('puts the meter marker where the live signal level says', () => {
    const marker = () =>
      parseFloat(
        StyleSheet.flatten(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.style)
          .left,
      );
    mockLive = { ...running, signalLevel: 0.1 };
    const { unmount } = renderRouter('./app', { initialUrl: '/practice' });
    expect(marker()).toBeCloseTo(13.2, 6);
    unmount();
    mockLive = { ...running, signalLevel: 0.9, advancing: true };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(marker()).toBeCloseTo(86.8, 6);
  });

  it('holds the marker at OK while the clean seconds are not counting', () => {
    mockLive = { ...running, signalLevel: 0.9, advancing: false };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(
      parseFloat(
        StyleSheet.flatten(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.style)
          .left,
      ),
    ).toBeCloseTo(50, 6);
  });

  it('draws no marker while the session has no level, as with no finger on the lens', () => {
    mockLive = { ...running, status: { ...running.status!, fingerCovered: false } };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.queryByTestId('signal-marker', { includeHiddenElements: true })).toBeNull();
  });
});

describe('practice reaching 30 of 30', () => {
  const finished = { ...running, cleanSeconds: 31, advancing: true };
  const settle = () => act(async () => {});
  // renderRouter turns on Jest's fake timers.
  const pass = (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });

  beforeEach(() => {
    mockRatePhone.mockReset();
  });

  it('does not rate or move on before 30 of 30', async () => {
    mockLive = { ...running, cleanSeconds: 30.5 };
    const route = renderRouter('./app', { initialUrl: '/practice' });
    await settle();
    await pass(5000);
    expect(mockRatePhone).not.toHaveBeenCalled();
    expect(screen.queryByText(en['practice.done'])).toBeNull();
    expect(route.getPathname()).toBe('/practice');
  });

  it('rates first, says it is done, then moves to How to sit 1.5 s later', async () => {
    let storeRating = (_rating: { score: number }) => {};
    mockRatePhone.mockReturnValue(
      new Promise((resolve) => {
        storeRating = resolve;
      }),
    );
    mockLive = finished;
    const route = renderRouter('./app', { initialUrl: '/practice' });
    await settle();
    expect(mockRatePhone).toHaveBeenCalledTimes(1);
    // The rating is not stored yet, so there is no done line and no countdown.
    await pass(5000);
    expect(screen.queryByText(en['practice.done'])).toBeNull();
    expect(route.getPathname()).toBe('/practice');

    await act(async () => storeRating({ score: 94 }));
    expect(screen.getByText(en['practice.done'])).toBeOnTheScreen();
    await pass(1499);
    expect(route.getPathname()).toBe('/practice');
    await pass(1);
    expect(route.getPathname()).toBe('/how-to-sit');
    expect(mockRatePhone).toHaveBeenCalledTimes(1);
  });

  it('pushes How to sit once when Continue is tapped during the 1.5 s', async () => {
    mockRatePhone.mockResolvedValue({ score: 94 });
    mockLive = finished;
    const route = renderRouter('./app', { initialUrl: '/practice' });
    await settle();
    expect(screen.getByText(en['practice.done'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    await pass(5000);
    expect(route.getPathname()).toBe('/how-to-sit');
    act(() => router.back());
    expect(route.getPathname()).toBe('/practice');
  });

  it('does not push again after Back from the automatic step, and Continue still works', async () => {
    mockRatePhone.mockResolvedValue({ score: 94 });
    mockLive = finished;
    const route = renderRouter('./app', { initialUrl: '/practice' });
    await settle();
    await pass(1500);
    expect(route.getPathname()).toBe('/how-to-sit');
    act(() => router.back());
    await pass(5000);
    expect(route.getPathname()).toBe('/practice');
    fireEvent.press(screen.getByRole('button', { name: en['common.continue'] }));
    expect(route.getPathname()).toBe('/how-to-sit');
  });

  it('drops the live chip and caption once the camera has stopped', async () => {
    mockRatePhone.mockReturnValue(new Promise(() => {}));
    mockLive = { ...running, nativeCamera: true, cleanSeconds: 5, advancing: true };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByText(en['capture.liveBadge'])).toBeOnTheScreen();
    expect(screen.getByText(en['capture.liveView'])).toBeOnTheScreen();
    screen.unmount();
    mockLive = { ...finished, nativeCamera: true };
    renderRouter('./app', { initialUrl: '/practice' });
    await settle();
    expect(screen.queryByText(en['capture.liveBadge'])).toBeNull();
    expect(screen.queryByText(en['capture.liveView'])).toBeNull();
    expect(screen.queryByText(en['coach.cover'])).toBeNull();
  });

  it('stays with the unrated explanation, and does not move on, when no rating is settled', async () => {
    mockRatePhone.mockResolvedValue(null);
    mockLive = finished;
    const route = renderRouter('./app', { initialUrl: '/practice' });
    await settle();
    expect(screen.getByText(en['rating.pending'])).toBeOnTheScreen();
    expect(screen.getByText(en['rating.practiceAgain'])).toBeOnTheScreen();
    await pass(5000);
    expect(screen.queryByText(en['practice.done'])).toBeNull();
    expect(route.getPathname()).toBe('/practice');
  });
});

describe('practice with the camera denied', () => {
  it('shows the denied line once, with Open Settings above the finger preview and the waveform', () => {
    jest.mocked(Linking.openSettings).mockClear();
    mockLive = { ...running, phase: 'denied', status: null };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getAllByText(en['capture.denied'])).toHaveLength(1);
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf(en['capture.openSettings'])).toBeLessThan(tree.indexOf('live-waveform'));
    fireEvent.press(screen.getByRole('button', { name: en['capture.openSettings'] }));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });
});
