import * as Linking from 'expo-linking';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

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
};

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
      parseFloat(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.cx);
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
    expect(parseFloat(screen.getByTestId('signal-marker', { includeHiddenElements: true }).props.cx)).toBeCloseTo(50, 6);
  });

  it('draws no marker while the session has no level, as with no finger on the lens', () => {
    mockLive = { ...running, status: { ...running.status!, fingerCovered: false } };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.queryByTestId('signal-marker', { includeHiddenElements: true })).toBeNull();
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
