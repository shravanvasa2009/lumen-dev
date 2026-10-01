import { act, renderHook } from '@testing-library/react-native';

import { readDemoHeartRate } from './demo';
import { useStandingTest } from './useStandingTest';

const SECOND = 1000;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function advance(seconds: number) {
  act(() => {
    jest.advanceTimersByTime(seconds * SECOND);
  });
}

describe('useStandingTest with a fake clock', () => {
  it('counts the lying period down and moves on to the baseline reading', () => {
    const { result: standingTest } = renderHook(() =>
      useStandingTest({ now: Date.now, readHeartRate: null }),
    );
    expect(standingTest.current.view.stage).toBe('intro');
    act(() => standingTest.current.start());
    advance(60);
    expect(standingTest.current.view).toMatchObject({ stage: 'lying', lyingRemainingMs: 4 * 60 * SECOND });
    advance(180);
    expect(standingTest.current.view.stage).toBe('baseline');
    expect(standingTest.current.view.dueSlot).toEqual({ minute: 0 });
  });

  it('never invents a reading when no source exists', () => {
    const { result: standingTest } = renderHook(() =>
      useStandingTest({ now: Date.now, readHeartRate: null }),
    );
    act(() => standingTest.current.start());
    advance(250);
    expect(standingTest.current.canRead).toBe(false);
    act(() => standingTest.current.takeReading());
    expect(standingTest.current.view.baseline).toBeNull();
  });

  it('plays the demo series through to a rise over the baseline', async () => {
    const { result: standingTest } = renderHook(() =>
      useStandingTest({ now: Date.now, readHeartRate: readDemoHeartRate }),
    );
    act(() => standingTest.current.start());
    advance(250);
    await act(async () => standingTest.current.takeReading());
    advance(50);
    expect(standingTest.current.view.dueSlot).toBeNull();
    advance(60);
    expect(standingTest.current.view.dueSlot).toEqual({ minute: 1 });
    await act(async () => standingTest.current.takeReading());
    expect(standingTest.current.view).toMatchObject({ baseline: 68, latest: 84, rise: 16 });
  });

  it('stops the clock when the person feels faint', () => {
    const { result: standingTest } = renderHook(() =>
      useStandingTest({ now: Date.now, readHeartRate: null }),
    );
    act(() => standingTest.current.start());
    advance(330);
    act(() => standingTest.current.stopForFaint());
    const frozen = standingTest.current.view.standingElapsedMs;
    advance(120);
    expect(standingTest.current.view).toMatchObject({
      stopped: true,
      fainted: true,
      standingElapsedMs: frozen,
    });
  });
});
