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

const midway: AnalysisProgress = {
  steps: { beats: 'done', rhythm: 'done', breathing: 'active', baseline: 'pending' },
  beats: 104,
  rejectedBeats: 6,
};

preloadAppRoutes();

describe('useReadingAnalysis', () => {
  it('reports unavailable until analyzeReading is in the app', () => {
    const actual = jest.requireActual<typeof import('./useReadingAnalysis')>('./useReadingAnalysis');
    expect(actual.useReadingAnalysis()).toEqual({
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

  it('moves on to the reading once the analysis is done', () => {
    const finished: AnalysisProgress = {
      ...midway,
      steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
    };
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo' };
    const route = renderRouter('./app', { initialUrl: '/measure/processing' });
    expect(route.getPathname()).toBe('/results/demo');
  });
});
