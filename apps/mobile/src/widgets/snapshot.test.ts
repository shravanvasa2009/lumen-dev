import type { ReadingResult } from '@lumen/core';

import type { StoredReading } from '@/home/readings';
import { makeReading } from '@/testing/reading';

import { widgetSnapshot, type WidgetSnapshot, type WidgetStatus } from './snapshot';

const NOW = new Date(2026, 9, 4, 9, 30).getTime();
const HOUR = 60 * 60 * 1000;

function dayAt(daysAgo: number, hour = 8): number {
  const today = new Date(NOW);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour).getTime();
}

type Change = (outcome: ReadingResult) => void;

function readingWith(change: Change, takenAt = NOW - HOUR): StoredReading {
  const reading = makeReading(takenAt, 64, 42);
  change(reading.outcome);
  return reading;
}

function snapshotOf(readings: readonly StoredReading[], hideValues = false): WidgetSnapshot {
  return widgetSnapshot({ readings, hideValues, theme: 'system', nextConfirmationAt: null, now: NOW });
}

function rhythm(flag: 'irregular' | 'possibleAf' | null): Change {
  return (outcome) => {
    outcome.metrics.rhythm = { class: 'sinus', pAF: 0.1, evidence: 'public-data', confidence: 'high', flag };
  };
}

function hrFlag(flag: 'slowResting' | 'fastResting' | 'fastRegular'): Change {
  return (outcome) => {
    if (outcome.metrics.hr) outcome.metrics.hr.flag = flag;
  };
}

function diabetes(evidence: 'public-data' | 'experimental'): Change {
  return (outcome) => {
    outcome.metrics.diabetes = {
      probability: 0.8,
      readingsUsed: 2,
      evidence,
      confidence: 'high',
      flag: 'pattern',
    };
  };
}

const inconclusive: Change = (outcome) => {
  outcome.headlineKey = 'result.inconclusive';
  outcome.metrics.hr = null;
  outcome.metrics.rmssd = null;
};

const uncertain: Change = (outcome) => {
  outcome.headlineKey = 'result.uncertain';
};

type Outcome = {
  name: string;
  change: Change;
  status: WidgetStatus;
  rhythmFlag: boolean;
  diabetesFlag: boolean;
};

// Every headline and every flag of the results type, with the widget status each one maps to.
const outcomes: readonly Outcome[] = [
  { name: 'a regular reading', change: () => {}, status: 'regular', rhythmFlag: false, diabetesFlag: false },
  {
    name: 'a regular rhythm',
    change: rhythm(null),
    status: 'regular',
    rhythmFlag: false,
    diabetesFlag: false,
  },
  {
    name: 'an inconclusive reading',
    change: inconclusive,
    status: 'inconclusive',
    rhythmFlag: false,
    diabetesFlag: false,
  },
  {
    name: "a couldn't-tell reading",
    change: uncertain,
    status: 'check-again',
    rhythmFlag: false,
    diabetesFlag: false,
  },
  {
    name: 'one irregular reading',
    change: rhythm('irregular'),
    status: 'check-again',
    rhythmFlag: true,
    diabetesFlag: false,
  },
  {
    name: 'a slow resting rate',
    change: hrFlag('slowResting'),
    status: 'check-again',
    rhythmFlag: false,
    diabetesFlag: false,
  },
  {
    name: 'a fast resting rate',
    change: hrFlag('fastResting'),
    status: 'check-again',
    rhythmFlag: false,
    diabetesFlag: false,
  },
  {
    name: 'possible AFib',
    change: rhythm('possibleAf'),
    status: 'see-doctor',
    rhythmFlag: true,
    diabetesFlag: false,
  },
  {
    name: 'a fast regular rhythm',
    change: hrFlag('fastRegular'),
    status: 'see-doctor',
    rhythmFlag: false,
    diabetesFlag: false,
  },
  {
    name: 'the diabetes pattern',
    change: diabetes('public-data'),
    status: 'see-doctor',
    rhythmFlag: false,
    diabetesFlag: true,
  },
  {
    name: 'the diabetes pattern below its evidence floor',
    change: diabetes('experimental'),
    status: 'regular',
    rhythmFlag: false,
    diabetesFlag: false,
  },
  {
    name: 'a fast regular rhythm in an otherwise inconclusive reading',
    change: (outcome) => {
      inconclusive(outcome);
      outcome.metrics.hr = {
        value: 180,
        unit: 'bpm',
        evidence: 'checked',
        confidence: 'moderate',
        flag: 'fastRegular',
      };
    },
    status: 'see-doctor',
    rhythmFlag: false,
    diabetesFlag: false,
  },
];

const APPENDIX_B_KEYS = [
  'v',
  'updatedAt',
  'lastReadingAt',
  'status',
  'hrBpm',
  'rhythmFlag',
  'diabetesFlag',
  'nextConfirmationAt',
  'streakDays',
  'hideValues',
  'theme',
];

// Condition names in English and Spanish, as in scripts/check-notification-copy.mjs. Only values are
// checked: the snapshot's own keys (rhythmFlag, diabetesFlag) are fixed by Appendix B.
const CONDITION_NAMES = [
  /\bafib\b/i,
  /\bpossibleAf\b/,
  /\bfibrilaci[oó]n\b/i,
  /diabet/i,
  /\bpots\b/i,
  /\bpsvt\b/i,
  /\btsvp\b/i,
  /irregular/i,
  /\barritmia\b/i,
  /pattern/i,
];

const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

describe('widget status', () => {
  it.each(outcomes)('maps $name to $status', ({ change, status, rhythmFlag, diabetesFlag }) => {
    expect(snapshotOf([readingWith(change)])).toMatchObject({ status, rhythmFlag, diabetesFlag });
  });

  it('follows the latest reading, not an older flagged one', () => {
    const older = readingWith(rhythm('possibleAf'), NOW - 3 * HOUR);
    const newer = readingWith(() => {}, NOW - HOUR);
    expect(snapshotOf([newer, older])).toMatchObject({ status: 'regular', rhythmFlag: false });
  });
});

describe('heart rate on the widget', () => {
  it('shows the rounded rate', () => {
    expect(snapshotOf([makeReading(NOW - HOUR, 63.6, null)]).hrBpm).toBe(64);
  });

  it('is null when values are hidden', () => {
    const snapshot = snapshotOf([makeReading(NOW - HOUR, 64, null)], true);
    expect(snapshot).toMatchObject({ hrBpm: null, hideValues: true });
  });

  it('is null when the reading has no rate', () => {
    expect(snapshotOf([makeReading(NOW - HOUR, null, null)]).hrBpm).toBeNull();
  });
});

describe('empty history', () => {
  it('has no reading, no status, no flags, and no streak', () => {
    expect(snapshotOf([])).toEqual({
      v: 1,
      updatedAt: new Date(NOW).toISOString().replace('.000Z', 'Z'),
      lastReadingAt: null,
      status: null,
      hrBpm: null,
      rhythmFlag: false,
      diabetesFlag: false,
      nextConfirmationAt: null,
      streakDays: 0,
      hideValues: false,
      theme: 'system',
    });
  });
});

describe('times', () => {
  it('writes UTC times to the second', () => {
    const snapshot = widgetSnapshot({
      readings: [makeReading(NOW - HOUR + 123, 64, null)],
      hideValues: false,
      theme: 'dark',
      nextConfirmationAt: NOW + 2 * HOUR + 456,
      now: NOW + 789,
    });
    expect(snapshot.updatedAt).toMatch(UTC_SECONDS);
    expect(snapshot.lastReadingAt).toMatch(UTC_SECONDS);
    expect(snapshot.nextConfirmationAt).toMatch(UTC_SECONDS);
    expect(Date.parse(snapshot.nextConfirmationAt ?? '')).toBe(NOW + 2 * HOUR);
    expect(snapshot.theme).toBe('dark');
  });
});

describe('streak', () => {
  const streakOf = (times: readonly number[]) =>
    snapshotOf(times.map((time) => makeReading(time, 64, null))).streakDays;

  it('counts consecutive days ending today', () => {
    expect(streakOf([dayAt(0), dayAt(1), dayAt(2), dayAt(4)])).toBe(3);
  });

  it('still counts a run that ended yesterday', () => {
    expect(streakOf([dayAt(1), dayAt(2)])).toBe(2);
  });

  it('is zero once a whole day passes with no check', () => {
    expect(streakOf([dayAt(2), dayAt(3)])).toBe(0);
  });

  it('counts a day once however many readings it has', () => {
    expect(streakOf([dayAt(0, 7), dayAt(0, 8), dayAt(0, 9), dayAt(1, 23)])).toBe(2);
  });

  it('counts local days, so a late-night and an early-morning reading are two days', () => {
    expect(streakOf([dayAt(1, 23), dayAt(0, 0)])).toBe(2);
  });
});

describe('privacy and size', () => {
  const worstCase = (hideValues: boolean) =>
    widgetSnapshot({
      readings: Array.from({ length: 400 }, (_, index) =>
        readingWith((outcome) => {
          rhythm('possibleAf')(outcome);
          diabetes('public-data')(outcome);
          if (outcome.metrics.hr) outcome.metrics.hr.value = 219.6;
        }, dayAt(index)),
      ),
      hideValues,
      theme: 'system',
      nextConfirmationAt: NOW + 30 * 24 * HOUR,
      now: NOW,
    });

  it.each([false, true])('stays within 1 KB of UTF-8 (hide values: %s)', (hideValues) => {
    const json = JSON.stringify(worstCase(hideValues));
    expect(worstCase(hideValues).streakDays).toBe(400);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(1024);
  });

  const everySnapshot = [
    ...outcomes.map(({ change }) => snapshotOf([readingWith(change)])),
    ...outcomes.map(({ change }) => snapshotOf([readingWith(change)], true)),
    snapshotOf([]),
  ];

  it.each(everySnapshot)('holds only the Appendix B fields, each a single value', (snapshot) => {
    const parsed: Record<string, unknown> = JSON.parse(JSON.stringify(snapshot));
    expect(Object.keys(parsed).sort()).toEqual([...APPENDIX_B_KEYS].sort());
    for (const value of Object.values(parsed)) {
      expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
    }
  });

  it.each(everySnapshot)('names no condition in any value', (snapshot) => {
    const strings = Object.values(snapshot).filter((value): value is string => typeof value === 'string');
    for (const text of strings) {
      expect(CONDITION_NAMES.filter((pattern) => pattern.test(text))).toEqual([]);
    }
  });
});
