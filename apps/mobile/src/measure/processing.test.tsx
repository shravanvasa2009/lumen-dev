import { renderHook } from '@testing-library/react-native';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { type AnalysisProgress, completedPercent, pendingProgress } from './analysisProgress';
import type { AnalysisState } from './useReadingAnalysis';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

let mockAnalysis: AnalysisState;
jest.mock('./useReadingAnalysis', () => ({ useReadingAnalysis: () => mockAnalysis }));

let mockRating: { tier: string; ambient: boolean; fpsLevel: number } | null = null;
jest.mock('@/store/useStoredRating', () => ({ useStoredRating: () => mockRating }));

const midway: AnalysisProgress = {
  steps: { beats: 'done', rhythm: 'done', breathing: 'active', baseline: 'pending' },
  beats: 104,
  rejectedBeats: 6,
  outputs: null,
};

preloadAppRoutes();

describe('useReadingAnalysis', () => {
  it('reports unavailable when no capture was kept', () => {
    const actual = jest.requireActual<typeof import('./useReadingAnalysis')>('./useReadingAnalysis');
    const { result: analysis } = renderHook(() => actual.useReadingAnalysis());
    expect(analysis.current).toEqual({
      phase: 'unavailable',
    });
  });
});

describe('completedPercent', () => {
  it('counts finished steps only', () => {
    expect(completedPercent(pendingProgress)).toBe(0);
    expect(completedPercent(midway)).toBe(50);
    expect(
      completedPercent({
        ...midway,
        steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
      }),
    ).toBe(100);
  });
});

describe('processing screen', () => {
  beforeEach(() => {
    mockAnalysis = { phase: 'unavailable' };
    mockRating = null;
  });

  it('shows every step waiting, no percentage and no counts when nothing can be analysed', () => {
    renderRouter('./app', { initialUrl: '/measure/processing?mode=quick' });
    expect(screen.getByRole('header', { name: en['processing.title'] })).toBeOnTheScreen();
    expect(screen.getByText(en['processing.unavailable'])).toBeOnTheScreen();
    expect(screen.queryByText(en['processing.subtitle'])).toBeNull();
    expect(screen.queryByText(/\d+%/)).toBeNull();
    expect(screen.queryByText(/\d+ (heartbeats|rejected)/)).toBeNull();
    expect(screen.getAllByLabelText(new RegExp(`${en['processing.statePending']}$`))).toHaveLength(4);
    expect(screen.getByText(en['processing.onPhone'])).toBeOnTheScreen();
  });

  it('opens the sample result from See a sample result', () => {
    renderRouter('./app', { initialUrl: '/measure/processing' });
    fireEvent.press(screen.getByRole('button', { name: en['processing.seeSample'] }));
    expect(screen.getByRole('header', { name: en['results.title'] })).toBeOnTheScreen();
  });

  it('goes back to Home', () => {
    const route = renderRouter('./app', { initialUrl: '/measure/processing' });
    fireEvent.press(screen.getByRole('button', { name: en['processing.backHome'] }));
    expect(route.getPathname()).toBe('/');
  });

  it('draws each step from the progress it is given', () => {
    mockAnalysis = { phase: 'running', progress: midway };
    renderRouter('./app', { initialUrl: '/measure/processing' });
    expect(screen.getByText('50%')).toBeOnTheScreen();
    expect(screen.getByText(en['processing.subtitle'])).toBeOnTheScreen();
    expect(screen.getByText('Cleaned 104 heartbeats')).toBeOnTheScreen();
    expect(screen.getByText('6 rejected')).toBeOnTheScreen();
    expect(screen.getByLabelText(/Cleaned 104 heartbeats, 6 rejected\. Done$/)).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`${en['processing.rhythm']}. ${en['processing.stateDone']}`),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`${en['processing.breathing']}. ${en['processing.stateActive']}`),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`${en['processing.baseline']}. ${en['processing.statePending']}`),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en['processing.seeResults'] })).toBeNull();
  });

  it('reads Checking or Waiting from the steps, and Ready for nothing before the reading holds a result', () => {
    mockAnalysis = { phase: 'running', progress: midway };
    renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(screen.getByText(en['checks.inReading'])).toBeOnTheScreen();
    expect(screen.getAllByText(en['checks.state.working'])).toHaveLength(2);
    expect(screen.getAllByText(en['checks.state.waiting'])).toHaveLength(1);
    expect(screen.queryByText(en['checks.state.ready'])).toBeNull();
    expect(screen.getByText(en['checks.from.standing'])).toBeOnTheScreen();
    expect(screen.getAllByTestId('evidence-badge')).toHaveLength(1);
  });

  it('shows Ready only for checks with a real result and Not run for Diabetes with none', () => {
    const finished: AnalysisProgress = {
      steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
      beats: 104,
      rejectedBeats: 6,
      outputs: { afib: true, hrv: true, diabetes: false },
    };
    mockAnalysis = { phase: 'failed', progress: finished, reason: 'kept on screen' };
    renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(screen.getAllByText(en['checks.state.ready'])).toHaveLength(2);
    expect(screen.getAllByText(en['checks.state.notRun'])).toHaveLength(1);
  });

  it('marks every check not in a Quick Check, where the 30 s reading cannot run the rhythm check', () => {
    mockAnalysis = { phase: 'running', progress: midway };
    renderRouter('./app', { initialUrl: '/measure/processing?mode=quick' });
    expect(screen.getAllByText(en['checks.state.off'])).toHaveLength(3);
    expect(screen.queryByText(en['checks.state.working'])).toBeNull();
  });

  it('shows HRV and Diabetes locked, not ready, on a Basic phone', () => {
    mockRating = { tier: 'basic', ambient: false, fpsLevel: 30 };
    const finished: AnalysisProgress = {
      steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
      beats: 104,
      rejectedBeats: 6,
      outputs: { afib: true, hrv: true, diabetes: true },
    };
    mockAnalysis = { phase: 'failed', progress: finished, reason: 'kept on screen' };
    renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(screen.getAllByText(en['mode.locked60fps'])).toHaveLength(2);
    expect(screen.getAllByText(en['checks.state.ready'])).toHaveLength(1);
  });

  it('moves on to the reading once the analysis is done', () => {
    const finished: AnalysisProgress = {
      ...midway,
      steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
    };
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo' };
    const route = renderRouter('./app', { initialUrl: '/measure/processing' });
    expect(route.getPathname()).toBe('/results/demo');
  });

  it('opens the Inconclusive screen with the mode when the capture was refused', () => {
    mockAnalysis = { phase: 'inconclusive', progress: pendingProgress, reason: 'tooShort' };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/measure/inconclusive');
    expect(route.getSearchParams()).toEqual({ mode: 'full' });
  });
});
