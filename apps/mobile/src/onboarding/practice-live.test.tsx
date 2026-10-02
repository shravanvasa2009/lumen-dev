import { renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import type { LiveCapture } from '@/measure/useLiveCapture';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

let mockLive: LiveCapture;
jest.mock('@/measure/useLiveCapture', () => ({ useLiveCapture: () => mockLive }));

const running: LiveCapture = {
  phase: 'running',
  failure: null,
  status: { fingerCovered: true, motionRms: 0, thermal: 'nominal', fps: 60, droppedFrac: 0 },
  recentRed: [0.6, 0.62, 0.58, 0.61],
  elapsedS: 5,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
};

describe('practice with a running capture', () => {
  it('draws the pulse, drops the cover coaching and waits for a clean signal', () => {
    mockLive = running;
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByTestId('live-waveform', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(en['coach.cover'])).toBeNull();
    expect(screen.getByText(en['capture.waiting'])).toBeOnTheScreen();
    expect(screen.getByText('0 of 15 steady seconds')).toBeOnTheScreen();
  });

  it('coaches to cover the lens when the module reports no finger', () => {
    mockLive = { ...running, status: { ...running.status!, fingerCovered: false } };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByText(en['coach.cover'])).toBeOnTheScreen();
  });

  it('shows the steady seconds and the coaching key a session supplies', () => {
    mockLive = { ...running, cleanSeconds: 9.6, coachingKey: 'coach.still' };
    renderRouter('./app', { initialUrl: '/practice' });
    expect(screen.getByText('9 of 15 steady seconds')).toBeOnTheScreen();
    expect(screen.getByText(en['coach.still'])).toBeOnTheScreen();
  });
});
