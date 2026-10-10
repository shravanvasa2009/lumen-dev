import type { InconclusiveOutcome, UrgentHeartRate } from '@lumen/core';
import { renderHook } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { BackHandler, Modal } from 'react-native';

import en from '@/i18n/en.json';
import { CLOSE_SHIELD_MS } from '@/results/SafetySheet';
import { expectNavTitle } from '@/testing/navHeader';
import { pressNo } from '@/testing/pressNo';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { keepCapture } from './keptCapture';
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
    expectNavTitle(en['results.title']);
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
    expect(screen.queryByTestId('evidence-badge')).toBeNull();
  });

  it('shows Ready only for checks with a real result and Not run for Diabetes with none', () => {
    const finished: AnalysisProgress = {
      steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
      beats: 104,
      rejectedBeats: 6,
      outputs: { afib: true, hrv: true, diabetes: false },
    };
    mockAnalysis = { phase: 'failed', progress: finished, reason: 'kept on screen', urgent: null };
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
    mockAnalysis = { phase: 'failed', progress: finished, reason: 'kept on screen', urgent: null };
    renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(screen.getAllByText(en['mode.locked60fps'])).toHaveLength(2);
    expect(screen.getAllByText(en['checks.state.ready'])).toHaveLength(1);
  });

  it('moves on to the reading once the analysis is done', () => {
    const finished: AnalysisProgress = {
      ...midway,
      steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
    };
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo', urgent: null };
    const route = renderRouter('./app', { initialUrl: '/measure/processing' });
    expect(route.getPathname()).toBe('/results/demo');
  });

  it('replaces itself with Inconclusive when the capture had too little clean signal', () => {
    keepCapture({
      captureFps: 60,
      lensId: null,
      samples: [],
      stats: [],
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
    });
    const outcome: InconclusiveOutcome = {
      kind: 'inconclusive',
      reasons: ['tooFewCleanSeconds', 'noHeartRate'],
      cleanSeconds: 0,
      neededCleanSeconds: 90,
      lostSeconds: { motion: 0, pressure: 0, coverage: 12, coldHands: 0 },
      otherLostSeconds: 0,
      causes: ['coverage'],
      urgent: null,
    };
    mockAnalysis = { phase: 'inconclusive', progress: midway, outcome };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/measure/inconclusive');
    expect(route.getSearchParams()).toEqual({ mode: 'full' });
    expect(screen.getByRole('header', { name: en['result.inconclusive'] })).toBeOnTheScreen();
    expect(screen.getByText('We got 0 clean seconds. Most of the lost time was light.')).toBeOnTheScreen();
    expect(screen.getByText('This check needs at least 90 clean seconds.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Light 100%')).toBeOnTheScreen();
    expect(screen.getByText(en['inconclusive.tipCover'])).toBeOnTheScreen();
    expect(screen.getByText(en['inconclusive.tipElbows'])).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
    keepCapture(null);
  });

  it('opens the Inconclusive screen with the mode when the capture was refused', () => {
    mockAnalysis = { phase: 'inconclusive', progress: pendingProgress, outcome: null };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/measure/inconclusive');
    expect(route.getSearchParams()).toEqual({ mode: 'full' });
  });

  it('forwards the context answers to the Inconclusive screen', () => {
    mockAnalysis = { phase: 'inconclusive', progress: pendingProgress, outcome: null };
    const route = renderRouter('./app', {
      initialUrl: '/measure/processing?mode=full&context=caffeine%2Cexercise',
    });
    expect(route.getPathname()).toBe('/measure/inconclusive');
    expect(route.getSearchParams()).toEqual({ mode: 'full', context: 'caffeine,exercise' });
  });
});

describe('urgent heart rates (SAFE-1, ADR 0076)', () => {
  const finished: AnalysisProgress = {
    ...midway,
    steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
  };
  const refusalWith = (urgent: UrgentHeartRate | null): InconclusiveOutcome => ({
    kind: 'inconclusive',
    reasons: ['tooFewCleanSeconds'],
    cleanSeconds: 60,
    neededCleanSeconds: 90,
    lostSeconds: { motion: 0, pressure: 0, coverage: 0, coldHands: 0 },
    otherLostSeconds: 0,
    causes: [],
    urgent,
  });
  const fast: UrgentHeartRate = { fastSustained: true, slowBelow40: false };
  const slow: UrgentHeartRate = { fastSustained: false, slowBelow40: true };

  afterEach(() => keepCapture(null));

  it('opens Emergency directly for a reading with a sustained fast rate', () => {
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo', urgent: fast };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/emergency');
    expect(screen.getByRole('button', { name: en['emergency.call'] })).toBeOnTheScreen();
  });

  it('opens Emergency directly for a refused capture with a sustained fast rate', () => {
    mockAnalysis = { phase: 'inconclusive', progress: midway, outcome: refusalWith(fast) };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/emergency');
  });

  it('opens Emergency directly when both flags are set', () => {
    mockAnalysis = {
      phase: 'done',
      progress: finished,
      readingId: 'demo',
      urgent: { fastSustained: true, slowBelow40: true },
    };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/emergency');
    expect(screen.queryByText(en['safety.question'])).toBeNull();
  });

  it('asks the symptom question for a rate under 40, and Yes opens Emergency', () => {
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo', urgent: slow };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/measure/processing');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(route.getPathname()).toBe('/emergency');
  });

  it('continues to the result when the answer is No', () => {
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo', urgent: slow };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    pressNo();
    expect(route.getPathname()).toBe('/results/demo');
  });

  it('asks the symptom question for a refused capture too, and No continues to Inconclusive', () => {
    mockAnalysis = { phase: 'inconclusive', progress: midway, outcome: refusalWith(slow) };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    expect(route.getPathname()).toBe('/measure/processing');
    pressNo(CLOSE_SHIELD_MS - 1);
    expect(route.getPathname()).toBe('/measure/processing');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    act(() => jest.advanceTimersByTime(1));
    expect(route.getPathname()).toBe('/measure/inconclusive');
  });

  it('shows no Emergency and no question when urgent is null', () => {
    mockAnalysis = { phase: 'inconclusive', progress: midway, outcome: refusalWith(null) };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/measure/inconclusive');
    expect(screen.queryByText(en['safety.question'])).toBeNull();
  });

  // ADR 0093: this replaces "dismissing the question with the scrim continues like No", a ruled change.
  it('keeps the question open when the scrim is tapped, and goes nowhere', () => {
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo', urgent: slow };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    fireEvent.press(screen.getByTestId('sheet-scrim-press'));
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    expect(route.getPathname()).toBe('/measure/processing');
  });

  it('keeps the question open on Android Back, and goes nowhere', () => {
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo', urgent: slow };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    expect(route.getPathname()).toBe('/measure/processing');
  });

  describe('when the analysis failed after the outcome', () => {
    const failedWith = (urgent: UrgentHeartRate | null): AnalysisState => ({
      phase: 'failed',
      progress: finished,
      reason: 'disk full',
      urgent,
    });

    it('opens Emergency for a sustained fast rate', () => {
      mockAnalysis = failedWith(fast);
      const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
      expect(route.getPathname()).toBe('/emergency');
    });

    it('asks the question for a rate under 40, Yes opens Emergency, No shows the failed screen', () => {
      mockAnalysis = failedWith(slow);
      const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
      expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
      pressNo();
      expect(route.getPathname()).toBe('/measure/processing');
      expect(screen.getByText(en['processing.failed'])).toBeOnTheScreen();
    });

    it('opens Emergency on Yes', () => {
      mockAnalysis = failedWith(slow);
      const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
      fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
      expect(route.getPathname()).toBe('/emergency');
    });

    it('keeps the failed screen when there are no flags', () => {
      mockAnalysis = failedWith(null);
      const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
      expect(route.getPathname()).toBe('/measure/processing');
      expect(screen.queryByText(en['safety.question'])).toBeNull();
      expect(screen.getByText(en['processing.failed'])).toBeOnTheScreen();
    });
  });
});

describe('leaving Processing during the analysis (SAFE-1)', () => {
  let backHandlers: Parameters<typeof BackHandler.addEventListener>[1][];
  const backPressEaten = () => backHandlers.some((handler) => handler(undefined as never) === true);

  beforeEach(() => {
    backHandlers = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      backHandlers.push(handler);
      return { remove: () => (backHandlers = backHandlers.filter((other) => other !== handler)) };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('eats the Android back press while the analysis runs', () => {
    mockAnalysis = { phase: 'running', progress: midway };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(backPressEaten()).toBe(true);
    expect(route.getPathname()).toBe('/measure/processing');
  });

  it('lets the back press through once the analysis has failed', () => {
    mockAnalysis = { phase: 'failed', progress: midway, reason: 'disk full', urgent: null };
    renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(backPressEaten()).toBe(false);
  });

  it('lets the back press through when there is nothing to analyse', () => {
    mockAnalysis = { phase: 'unavailable' };
    renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(backPressEaten()).toBe(false);
  });
});

describe('the symptom question is asked once per reading', () => {
  const finished: AnalysisProgress = {
    ...midway,
    steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
  };

  it('does not ask again on Results after No on Processing', () => {
    mockAnalysis = {
      phase: 'done',
      progress: finished,
      readingId: 'demo-hr-flag',
      urgent: { fastSustained: false, slowBelow40: true },
    };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    pressNo();
    expect(route.getPathname()).toBe('/results/demo-hr-flag');
    expect(screen.queryByText(en['safety.question'])).toBeNull();
  });

  it('leaves nothing marked when no question was asked, so Results asks for a flagged reading', () => {
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo-hr-flag', urgent: null };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/results/demo-hr-flag');
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
  });

  it('does not mark the reading as asked in its URL, so no link can switch the question off', () => {
    mockAnalysis = {
      phase: 'done',
      progress: finished,
      readingId: 'demo-hr-flag',
      urgent: { fastSustained: false, slowBelow40: true },
    };
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    pressNo();
    expect(route.getSearchParams()).toEqual({ id: 'demo-hr-flag' });
  });
});

describe('urgent flags known while the analysis still runs (SAFE-1)', () => {
  const running = (urgent?: UrgentHeartRate | null): AnalysisState => ({
    phase: 'running',
    progress: midway,
    urgent,
  });
  const finished: AnalysisProgress = {
    ...midway,
    steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
  };
  const slow: UrgentHeartRate = { fastSustained: false, slowBelow40: true };

  it('opens Emergency before the model and the save have finished', () => {
    mockAnalysis = running({ fastSustained: true, slowBelow40: false });
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(route.getPathname()).toBe('/emergency');
  });

  it('does not navigate again when the analysis finishes after an early Emergency', () => {
    mockAnalysis = running({ fastSustained: true, slowBelow40: false });
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    mockAnalysis = {
      phase: 'done',
      progress: finished,
      readingId: 'demo',
      urgent: { fastSustained: true, slowBelow40: false },
    };
    act(() => router.setParams({ mode: 'quick' }));
    expect(route.getPathname()).toBe('/emergency');
  });

  it('asks the symptom question while running, and Yes opens Emergency', () => {
    mockAnalysis = running(slow);
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    expect(screen.getByText(en['safety.question'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['safety.yes'] }));
    expect(route.getPathname()).toBe('/emergency');
  });

  it('waits for the reading after No, and does not leave before the question is answered', () => {
    mockAnalysis = running(slow);
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo-hr-flag', urgent: slow };
    act(() => router.setParams({ mode: 'quick' }));
    expect(route.getPathname()).toBe('/measure/processing');
    pressNo();
    expect(route.getPathname()).toBe('/results/demo-hr-flag');
    expect(screen.queryByText(en['safety.question'])).toBeNull();
  });

  it('opens Results once, with no second question, when No came before the reading was ready', () => {
    mockAnalysis = running(slow);
    const route = renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
    const replace = jest.spyOn(router, 'replace');
    pressNo();
    expect(replace).not.toHaveBeenCalled();
    expect(route.getPathname()).toBe('/measure/processing');
    mockAnalysis = { phase: 'done', progress: finished, readingId: 'demo-hr-flag', urgent: slow };
    act(() => router.setParams({ mode: 'quick' }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/results/demo-hr-flag');
    expect(route.getPathname()).toBe('/results/demo-hr-flag');
    expect(screen.queryByText(en['safety.question'])).toBeNull();
    replace.mockRestore();
  });

  describe('leaving', () => {
    let backHandlers: Parameters<typeof BackHandler.addEventListener>[1][];
    const backPressEaten = () => backHandlers.some((handler) => handler(undefined as never) === true);

    beforeEach(() => {
      backHandlers = [];
      jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
        backHandlers.push(handler);
        return { remove: () => (backHandlers = backHandlers.filter((other) => other !== handler)) };
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it('is blocked until the flags are known, then allowed while the analysis still runs', () => {
      mockAnalysis = running(undefined);
      renderRouter('./app', { initialUrl: '/measure/processing?mode=full' });
      expect(backPressEaten()).toBe(true);
      mockAnalysis = running(null);
      act(() => router.setParams({ mode: 'quick' }));
      expect(backPressEaten()).toBe(false);
    });
  });
});
