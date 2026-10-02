import { act, renderHook } from '@testing-library/react-native';

import { type ReadingSlot } from './protocol';
import { useStandingTest } from './useStandingTest';

const SECOND = 1000;
const TEST_BASELINE_BPM = 68;
const TEST_STANDING_BPM = 84;

type Reader = (minute: ReadingSlot['minute']) => Promise<number | null>;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function advance(seconds: number) {
  act(() => {
    jest.advanceTimersByTime(seconds * SECOND);
  });
}

function startAtBaseline(readHeartRate: Reader | null) {
  const { result: hook } = renderHook(() => useStandingTest({ now: Date.now, readHeartRate }));
  act(() => hook.current.start());
  advance(250);
  return hook;
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
    const standingTest = startAtBaseline(null);
    expect(standingTest.current.canRead).toBe(false);
    act(() => standingTest.current.takeReading());
    expect(standingTest.current.view.baseline).toBeNull();
  });

  it('records injected readings and their rise over the baseline', async () => {
    const standingTest = startAtBaseline(async (minute) =>
      minute === 0 ? TEST_BASELINE_BPM : TEST_STANDING_BPM,
    );
    await act(async () => standingTest.current.takeReading());
    advance(50);
    expect(standingTest.current.view.dueSlot).toBeNull();
    advance(60 + 30);
    await act(async () => standingTest.current.takeReading());
    expect(standingTest.current.view).toMatchObject({ baseline: 68, latest: 84, rise: 16 });
    expect(standingTest.current.view.points.at(-1)?.minute).toBeCloseTo(1.5, 1);
  });

  it('stops the clock when the person feels faint', () => {
    const standingTest = startAtBaseline(null);
    advance(80);
    act(() => standingTest.current.stopForFaint());
    const frozen = standingTest.current.view.standingElapsedMs;
    advance(120);
    expect(standingTest.current.view).toMatchObject({ stopped: true, standingElapsedMs: frozen });
  });

  it('ignores a reading that arrives after the test is stopped', async () => {
    let finishReading: (bpm: number) => void = () => undefined;
    const standingTest = startAtBaseline(
      () => new Promise<number | null>((resolve) => (finishReading = resolve)),
    );
    act(() => standingTest.current.takeReading());
    act(() => standingTest.current.stopForFaint());
    await act(async () => finishReading(TEST_BASELINE_BPM));
    expect(standingTest.current.view.baseline).toBeNull();
    expect(standingTest.current.reading).toBe(false);
  });

  it('does not start a second read while one is pending', async () => {
    let finishReading: (bpm: number) => void = () => undefined;
    const readHeartRate = jest.fn<ReturnType<Reader>, Parameters<Reader>>(
      () => new Promise((resolve) => (finishReading = resolve)),
    );
    const standingTest = startAtBaseline(readHeartRate);
    act(() => standingTest.current.takeReading());
    act(() => standingTest.current.takeReading());
    expect(readHeartRate).toHaveBeenCalledTimes(1);
    expect(standingTest.current.reading).toBe(true);
    await act(async () => finishReading(TEST_BASELINE_BPM));
    expect(standingTest.current.reading).toBe(false);
    expect(standingTest.current.view.baseline).toBe(TEST_BASELINE_BPM);
  });

  it('reports a rejected read, keeps the slot open and allows a retry', async () => {
    const readHeartRate = jest
      .fn<ReturnType<Reader>, Parameters<Reader>>()
      .mockRejectedValueOnce(new Error('camera busy'))
      .mockResolvedValueOnce(TEST_BASELINE_BPM);
    const standingTest = startAtBaseline(readHeartRate);
    await act(async () => standingTest.current.takeReading());
    expect(standingTest.current).toMatchObject({ readFailed: true, reading: false });
    expect(standingTest.current.view).toMatchObject({ baseline: null, dueSlot: { minute: 0 } });
    await act(async () => standingTest.current.takeReading());
    expect(standingTest.current.readFailed).toBe(false);
    expect(standingTest.current.view.baseline).toBe(TEST_BASELINE_BPM);
  });

  it('treats an inconclusive (null) read as a failed reading', async () => {
    const standingTest = startAtBaseline(async () => null);
    await act(async () => standingTest.current.takeReading());
    expect(standingTest.current.readFailed).toBe(true);
    expect(standingTest.current.view.baseline).toBeNull();
  });
});
