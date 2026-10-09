import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import type { LiveCapture } from './useLiveCapture';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

let mockLive: LiveCapture;
jest.mock('./useLiveCapture', () => ({ useLiveCapture: () => mockLive }));

const unavailable: LiveCapture = {
  phase: 'unavailable',
  failure: null,
  status: null,
  recentRed: [],
  recentPulse: [],
  elapsedS: 0,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
  signalLevel: null,
  nativeCamera: false,
  advancing: false,
  adjustingExposure: false,
};

preloadAppRoutes();

describe('capture route', () => {
  beforeEach(() => {
    mockLive = unavailable;
  });

  it('stays on capture with no clean seconds, however long it waits', () => {
    mockLive = { ...unavailable, phase: 'running', elapsedS: 400 };
    const route = renderRouter('./app', { initialUrl: '/measure/capture?mode=full' });
    expect(route.getPathname()).toBe('/measure/capture');
  });

  it('goes to processing with the rest and context params once the count is complete', () => {
    mockLive = { ...unavailable, phase: 'running', cleanSeconds: 30 };
    const route = renderRouter('./app', {
      initialUrl: '/measure/capture?mode=quick&restDone=true&context=caffeine',
    });
    expect(route.getPathname()).toBe('/measure/processing');
    expect(route.getSearchParams()).toEqual({ mode: 'quick', restDone: 'true', context: 'caffeine' });
  });

  it('does not go on at 29 of 30 clean seconds', () => {
    mockLive = { ...unavailable, phase: 'running', cleanSeconds: 29.9 };
    const route = renderRouter('./app', { initialUrl: '/measure/capture?mode=quick' });
    expect(route.getPathname()).toBe('/measure/capture');
  });

  it('ends inconclusive from Stop and returns Home from Cancel', () => {
    const route = renderRouter('./app', { initialUrl: '/measure/capture?mode=quick' });
    fireEvent.press(screen.getByRole('button', { name: en['capture.stop'] }));
    expect(route.getPathname()).toBe('/measure/inconclusive');
    expect(route.getSearchParams()).toEqual({ mode: 'quick' });
  });

  it('cancels back to Home', () => {
    const route = renderRouter('./app', { initialUrl: '/measure/capture?mode=full' });
    fireEvent.press(screen.getByRole('button', { name: en['capture.cancel'] }));
    expect(route.getPathname()).toBe('/');
  });
});
