import { act, renderHook } from '@testing-library/react-native';
import i18next from 'i18next';

import '@/i18n';
import { lockscreenStrings } from '@/i18n/lockscreen';
import tokens from '@/theme/tokens.json';

import { useStandingLiveTimer } from './useStandingLiveTimer';
import { type StandingTestSource, useStandingTest } from './useStandingTest';

const mockWidgets = {
  startStandingTimer: jest.fn(),
  updateStandingTimer: jest.fn(),
  endStandingTimer: jest.fn(),
};
let mockLinked = true;
jest.mock('../../modules/lumen-widgets/src', () => ({
  get LumenWidgets() {
    return mockLinked ? mockWidgets : null;
  },
}));

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const TEST_BPM = 70;
// Lying 5, standing 10, and the last reading's 45-second window.
const TEST_MINUTES = 15.75;
const lock = lockscreenStrings('en');

const source: StandingTestSource = { now: () => Date.now(), readHeartRate: async () => TEST_BPM };

function renderStandingTest() {
  return renderHook(() => {
    const test = useStandingTest(source);
    useStandingLiveTimer(test.view);
    return test;
  });
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

const lastContent = (mock: jest.Mock) => mock.mock.calls[mock.mock.calls.length - 1][0];

beforeEach(() => {
  jest.useFakeTimers();
  mockLinked = true;
  for (const call of Object.values(mockWidgets)) {
    call.mockReset();
    call.mockResolvedValue(undefined);
  }
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  await i18next.changeLanguage('en');
});

describe('standing-test live timer', () => {
  it('starts with the test, counting down to the baseline reading', () => {
    const { result: test } = renderStandingTest();
    expect(mockWidgets.startStandingTimer).not.toHaveBeenCalled();
    act(() => test.current.start());
    expect(mockWidgets.startStandingTimer).toHaveBeenCalledTimes(1);
    expect(lastContent(mockWidgets.startStandingTimer)).toEqual({
      channelName: lock['channel.standing'],
      actionLabel: lock['live.standing.measureNow'],
      title: lock['live.standing.title'],
      text: 'Next reading in',
      step: 'Step 1 of 5',
      tapHint: lock['live.standing.tap'],
      countdownMs: 4 * MINUTE,
      progress: 0,
      accentLight: tokens.light.accent,
      accentDark: tokens.dark.accent,
    });
  });

  it('updates only when the step or the due reading changes', async () => {
    const { result: test } = renderStandingTest();
    act(() => test.current.start());
    advance(3 * MINUTE);
    expect(mockWidgets.updateStandingTimer).not.toHaveBeenCalled();

    advance(MINUTE);
    expect(mockWidgets.updateStandingTimer).toHaveBeenCalledTimes(1);
    expect(lastContent(mockWidgets.updateStandingTimer)).toMatchObject({
      step: 'Step 2 of 5',
      text: lock['notif.standing'],
      tapHint: 'Tap to measure',
      countdownMs: null,
      progress: 4 / TEST_MINUTES,
    });

    await act(async () => test.current.takeReading());
    expect(mockWidgets.updateStandingTimer).toHaveBeenCalledTimes(2);
    // Standing minute 1 opens 6 minutes into the test.
    expect(lastContent(mockWidgets.updateStandingTimer)).toMatchObject({
      step: 'Step 2 of 5',
      text: 'Next reading in',
      countdownMs: 2 * MINUTE,
      progress: 4 / TEST_MINUTES,
    });
    expect(mockWidgets.startStandingTimer).toHaveBeenCalledTimes(1);
  });

  it('moves the progress bar at each update and shows the Spanish copy', async () => {
    const { result: test } = renderStandingTest();
    await act(async () => i18next.changeLanguage('es'));
    act(() => test.current.start());
    advance(4 * MINUTE);
    await act(async () => test.current.takeReading());
    advance(2 * MINUTE);
    expect(lastContent(mockWidgets.updateStandingTimer)).toMatchObject({
      title: 'Prueba de pie',
      step: 'Paso 3 de 5',
      tapHint: 'Toca para medir',
      countdownMs: null,
      progress: 6 / TEST_MINUTES,
    });
  });

  it('ends when the test is stopped', () => {
    const { result: test } = renderStandingTest();
    act(() => test.current.start());
    advance(MINUTE);
    act(() => test.current.stopForFaint());
    expect(mockWidgets.endStandingTimer).toHaveBeenCalledTimes(1);
    advance(MINUTE);
    expect(mockWidgets.updateStandingTimer).not.toHaveBeenCalled();
  });

  it('ends when the last reading window closes', () => {
    const { result: test } = renderStandingTest();
    act(() => test.current.start());
    advance(16 * MINUTE);
    expect(test.current.view.stage).toBe('done');
    expect(mockWidgets.endStandingTimer).toHaveBeenCalledTimes(1);
  });

  it('ends when the screen closes mid-test', () => {
    const { result: test, unmount } = renderStandingTest();
    act(() => test.current.start());
    unmount();
    expect(mockWidgets.endStandingTimer).toHaveBeenCalledTimes(1);
  });

  it('reports a timer the system refused', async () => {
    mockWidgets.startStandingTimer.mockRejectedValueOnce(new Error('channel blocked'));
    const { result: test } = renderStandingTest();
    await act(async () => test.current.start());
    expect(console.warn).toHaveBeenCalledWith('Standing-test live timer failed: channel blocked');
  });

  it('does nothing where the native module is not linked', () => {
    mockLinked = false;
    const { result: test, unmount } = renderStandingTest();
    act(() => test.current.start());
    advance(5 * MINUTE);
    unmount();
    for (const call of Object.values(mockWidgets)) expect(call).not.toHaveBeenCalled();
  });
});
