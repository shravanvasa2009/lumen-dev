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
    expect(viewAt(newTest(), 5 * MINUTE)).toMatchObject({ stage: 'intro', step: 1, dueSlot: null });
  });

  it('moves through lying, baseline, standing and done in order', () => {
    const stages = [at(0, 1), at(3, 59), at(4), at(4, 59), at(5), at(15, 44), at(15, 45)].map(
      (when) => viewAt(started, when).stage,
    );
    expect(stages).toEqual(['lying', 'lying', 'baseline', 'baseline', 'standing', 'standing', 'done']);
  });

  it('counts the lying period down from five minutes', () => {
    expect(formatClock(viewAt(started, at(0)).lyingRemainingMs)).toBe('05:00');
    expect(formatClock(viewAt(started, at(1, 30)).lyingRemainingMs)).toBe('03:30');
    expect(viewAt(started, at(6)).lyingRemainingMs).toBe(0);
  });

  it('offers the baseline reading in minute 4 to 5 only', () => {
    expect(viewAt(started, at(3)).dueSlot).toBeNull();
    expect(viewAt(started, at(4, 10)).dueSlot).toEqual({ minute: 0 });
    const taken = recordReading(started, { minute: 0 }, 68);
    expect(viewAt(taken, at(4, 20)).dueSlot).toBeNull();
    expect(viewAt(taken, at(4, 20)).baseline).toBe(68);
  });

  it('times standing from the end of lying and announces the next reading', () => {
    const view = viewAt(started, at(8, 12));
    expect(formatClock(view.standingElapsedMs)).toBe('03:12');
    expect(view.nextReadingAtMs).toBe(5 * MINUTE);
  });

  it('keeps each standing reading open until the next is due', () => {
    expect(viewAt(started, at(5, 59)).dueSlot).toBeNull();
    expect(viewAt(started, at(6)).dueSlot).toEqual({ minute: 1 });
    expect(viewAt(started, at(7, 59)).dueSlot).toEqual({ minute: 1 });
    expect(viewAt(started, at(8)).dueSlot).toEqual({ minute: 3 });
  });

  it('computes the rise from the latest standing reading and the baseline', () => {
    let state = recordReading(started, { minute: 0 }, 68);
    state = recordReading(state, { minute: 1 }, 84);
    state = recordReading(state, { minute: 3 }, 91);
    const view = viewAt(state, at(8, 12));
    expect(view).toMatchObject({ baseline: 68, latest: 91, rise: 23 });
    expect(view.points).toEqual([
      { minute: -1, bpm: 68 },
      { minute: 1, bpm: 84 },
      { minute: 3, bpm: 91 },
    ]);
  });

  it('has no rise without a baseline or a standing reading', () => {
    expect(viewAt(recordReading(started, { minute: 1 }, 84), at(7)).rise).toBeNull();
    expect(viewAt(recordReading(started, { minute: 0 }, 68), at(7)).rise).toBeNull();
  });

  it('records every standing minute', () => {
    const state = STANDING_READING_MINUTES.reduce(
      (kept, minute) => recordReading(kept, { minute }, 80 + minute),
      started,
    );
    expect(state.standing.map(({ bpm }) => bpm)).toEqual([81, 83, 85, 90]);
  });
});

describe('stopping', () => {
  it('freezes the timers and closes readings when stopped', () => {
    const stopped = stop(started, at(6, 30), false);
    const view = viewAt(stopped, at(12));
    expect(view).toMatchObject({ stopped: true, fainted: false, dueSlot: null });
    expect(formatClock(view.standingElapsedMs)).toBe('01:30');
  });

  it('remembers a faint stop and ignores a second stop', () => {
    const fainted = stop(started, at(6), true);
    expect(viewAt(stop(fainted, at(7), false), at(9)).fainted).toBe(true);
  });
});
