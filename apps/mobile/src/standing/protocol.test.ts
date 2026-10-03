import {
  begin,
  formatClock,
  newTest,
  recordReading,
  STANDING_READING_MINUTES,
  stop,
  viewAt,
} from './protocol';

const MINUTE = 60_000;
const started = begin(newTest(), 1_000_000);
const at = (minutes: number, seconds = 0) => 1_000_000 + minutes * MINUTE + seconds * 1000;

describe('standing test steps', () => {
  it('waits on the intro until begun', () => {
    expect(viewAt(newTest(), 5 * MINUTE)).toMatchObject({ stage: 'intro', step: 0, dueSlot: null });
  });

  it('moves through lying, baseline, standing, final and done in order', () => {
    const times = [at(0, 1), at(3, 59), at(4), at(4, 59), at(5), at(14, 59), at(15), at(15, 44), at(15, 45)];
    const views = times.map((when) => viewAt(started, when));
    expect(views.map(({ stage }) => stage)).toEqual([
      'lying',
      'lying',
      'baseline',
      'baseline',
      'standing',
      'standing',
      'final',
      'final',
      'done',
    ]);
    expect(views.map(({ step }) => step)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it('counts the lying period down from five minutes', () => {
    expect(formatClock(viewAt(started, at(0)).lyingRemainingMs)).toBe('05:00');
    expect(formatClock(viewAt(started, at(1, 30)).lyingRemainingMs)).toBe('03:30');
    expect(viewAt(started, at(6)).lyingRemainingMs).toBe(0);
  });

  it('tracks progress through the 15:45 test, held at 0 before it and 1 after it', () => {
    expect(viewAt(newTest(), at(3)).progress).toBe(0);
    expect(viewAt(started, at(0)).progress).toBe(0);
    expect(viewAt(started, at(4)).progress).toBeCloseTo(4 / 15.75);
    expect(viewAt(started, at(10)).progress).toBeCloseTo(10 / 15.75);
    expect(viewAt(started, at(15, 45)).progress).toBe(1);
    expect(viewAt(started, at(30)).progress).toBe(1);
    expect(viewAt(stop(started, at(2)), at(30)).progress).toBeCloseTo(2 / 15.75);
  });

  it('offers the baseline reading in minute 4 to 5 only', () => {
    expect(viewAt(started, at(3)).dueSlot).toBeNull();
    expect(viewAt(started, at(4, 10)).dueSlot).toEqual({ minute: 0 });
    const taken = recordReading(started, { minute: 0 }, 68, at(4, 10));
    expect(viewAt(taken, at(4, 20)).dueSlot).toBeNull();
    expect(viewAt(taken, at(4, 20)).baseline).toBe(68);
  });

  it('times standing from the end of lying and announces the next reading', () => {
    const view = viewAt(started, at(8, 12));
    expect(formatClock(view.standingElapsedMs)).toBe('03:12');
    expect(view.nextReadingAtMs).toBe(5 * MINUTE);
  });

  it('counts down to the next reading that opens, baseline first', () => {
    expect(viewAt(newTest(), at(0)).nextReadingInMs).toBeNull();
    expect(viewAt(started, at(1)).nextReadingInMs).toBe(3 * MINUTE);
    expect(viewAt(started, at(4, 30)).nextReadingInMs).toBe(MINUTE + 30_000);
    const withBaseline = recordReading(started, { minute: 0 }, 68, at(4, 10));
    expect(viewAt(withBaseline, at(4, 20)).nextReadingInMs).toBe(MINUTE + 40_000);
    const withMinuteOne = recordReading(withBaseline, { minute: 1 }, 80, at(6, 5));
    expect(viewAt(withMinuteOne, at(6, 10)).nextReadingInMs).toBe(MINUTE + 50_000);
    expect(viewAt(started, at(15, 10)).nextReadingInMs).toBeNull();
    expect(viewAt(stop(started, at(2)), at(3)).nextReadingInMs).toBeNull();
  });

  it('keeps each standing reading open until the next is due', () => {
    expect(viewAt(started, at(5, 59)).dueSlot).toBeNull();
    expect(viewAt(started, at(6)).dueSlot).toEqual({ minute: 1 });
    expect(viewAt(started, at(7, 59)).dueSlot).toEqual({ minute: 1 });
    expect(viewAt(started, at(8)).dueSlot).toEqual({ minute: 3 });
  });

  it('computes the rise from the latest standing reading and the baseline', () => {
    let state = recordReading(started, { minute: 0 }, 68, at(4, 10));
    state = recordReading(state, { minute: 1 }, 84, at(6, 30));
    state = recordReading(state, { minute: 3 }, 91, at(8, 30));
    const view = viewAt(state, at(8, 12));
    expect(view).toMatchObject({ baseline: 68, latest: 91, rise: 23 });
    expect(view.points).toEqual([
      { minute: -1, bpm: 68 },
      { minute: 1.5, bpm: 84 },
      { minute: 3.5, bpm: 91 },
    ]);
  });

  it('has no rise without a baseline or a standing reading', () => {
    expect(viewAt(recordReading(started, { minute: 1 }, 84, at(6, 30)), at(7)).rise).toBeNull();
    expect(viewAt(recordReading(started, { minute: 0 }, 68, at(4, 10)), at(7)).rise).toBeNull();
  });

  it('records every standing minute', () => {
    const state = STANDING_READING_MINUTES.reduce(
      (kept, minute) => recordReading(kept, { minute }, 80 + minute, at(5 + minute, 5)),
      started,
    );
    expect(state.standing.map(({ bpm }) => bpm)).toEqual([81, 83, 85, 90]);
  });
});

describe('stopping', () => {
  it('freezes the timers and closes readings when stopped', () => {
    const view = viewAt(stop(started, at(6, 30)), at(12));
    expect(view).toMatchObject({ stopped: true, dueSlot: null });
    expect(formatClock(view.standingElapsedMs)).toBe('01:30');
  });

  it('keeps the first stop time when stopped twice', () => {
    const view = viewAt(stop(stop(started, at(6)), at(7)), at(9));
    expect(formatClock(view.standingElapsedMs)).toBe('01:00');
  });

  it('drops a reading that arrives after the stop', () => {
    const stopped = stop(started, at(6, 30));
    expect(recordReading(stopped, { minute: 1 }, 84, at(6, 40))).toBe(stopped);
    expect(recordReading(stopped, { minute: 0 }, 68, at(6, 40))).toBe(stopped);
  });
});
