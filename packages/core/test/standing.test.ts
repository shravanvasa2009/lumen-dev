import { DSP_CONFIG, standingRise, type StandingMinute, type StandingReading } from '../src';

// Hand-computed cases for §10 DSP-16 and the §10.1 "Large rise on standing" rule (ADR 0063).

const BASELINE = 70;

const MINUTES: StandingMinute[] = [1, 3, 5, 10];

function readings(...bpms: (number | null)[]): StandingReading[] {
  return bpms.map((bpm, index) => {
    const minute = MINUTES[index];
    if (minute === undefined) throw new Error('the protocol has four standing slots');
    return { minute, bpm };
  });
}

// Runs the block once per value of the pending owner decision H-043 (ADR 0063 item 2).
function withFaintRule(flagPairBeforeFaintStop: boolean, block: () => void) {
  const shipped = DSP_CONFIG.dsp16.flagPairBeforeFaintStop;
  DSP_CONFIG.dsp16.flagPairBeforeFaintStop = flagPairBeforeFaintStop;
  try {
    block();
  } finally {
    DSP_CONFIG.dsp16.flagPairBeforeFaintStop = shipped;
  }
}

describe('DSP-16 config', () => {
  it('holds the spec thresholds', () => {
    expect(DSP_CONFIG.dsp16).toEqual({
      minAgeYears: 13,
      adolescentMaxAgeYears: 19,
      adolescentRiseBpm: 40,
      adultRiseBpm: 30,
      standingMinutes: [1, 3, 5, 10],
      consecutiveReadings: 2,
      flagPairBeforeFaintStop: false,
    });
  });
});

describe('DSP-16 rises', () => {
  it('reports HR − baseline per reading and null for an inconclusive one', () => {
    const outcome = standingRise(BASELINE, readings(95, null, 102.5, 64), 30, false);
    expect(outcome.rises).toEqual([
      { minute: 1, riseBpm: 25 },
      { minute: 3, riseBpm: null },
      { minute: 5, riseBpm: 32.5 },
      { minute: 10, riseBpm: -6 },
    ]);
  });
});

describe('DSP-16 age bands and thresholds', () => {
  // [age, rise in both of the first two readings, threshold, flagged]
  const cases: [number, number, number, boolean][] = [
    [20, 29, 30, false],
    [20, 30, 30, true],
    [20, 31, 30, true],
    [19, 39, 40, false],
    [19, 40, 40, true],
    [19, 30, 40, false],
    [13, 39, 40, false],
    [13, 40, 40, true],
    [65, 30, 30, true],
  ];
  it.each(cases)('age %i, rise %i: threshold %i, flagged %s', (age, rise, threshold, flagged) => {
    const outcome = standingRise(BASELINE, readings(BASELINE + rise, BASELINE + rise, 70, 70), age, false);
    expect(outcome.thresholdBpm).toBe(threshold);
    expect(outcome.flag).toBe(flagged ? 'largeRise' : null);
  });

  // Fractional rates: a version that rounded the rise (29.5 or 29.6 → 30) would flag these.
  const fractional: [number, number, number, boolean][] = [
    [70, 99.6, 30, false],
    [70, 99.5, 30, false],
    [69.5, 99.25, 30, false],
    [70, 100, 30, true],
    [69.5, 99.5, 30, true],
    [70, 109.6, 19, false],
    [70, 109.5, 19, false],
    [70, 110, 19, true],
  ];
  it.each(fractional)('baseline %f, both readings %f, age %i: flagged %s', (baseline, bpm, age, flagged) => {
    const outcome = standingRise(baseline, readings(bpm, bpm, baseline, baseline), age, false);
    expect(outcome.flag).toBe(flagged ? 'largeRise' : null);
  });

  it('rejects ages under 13, which the profile blocks (§6.6)', () => {
    expect(() => standingRise(BASELINE, readings(110, 110, 110, 110), 12, false)).toThrow(RangeError);
  });

  it('rejects an age that is not a whole number of years', () => {
    expect(() => standingRise(BASELINE, readings(110, 110, 110, 110), 19.5, false)).toThrow(RangeError);
    expect(() => standingRise(BASELINE, readings(110, 110, 110, 110), Number.NaN, false)).toThrow(RangeError);
  });
});

describe('DSP-16 two consecutive readings', () => {
  it('flags a pair at minutes 5 and 10', () => {
    expect(standingRise(BASELINE, readings(80, 85, 100, 101), 30, false).flag).toBe('largeRise');
  });

  it('does not flag rises at minutes 1 and 5 when minute 3 is below', () => {
    expect(standingRise(BASELINE, readings(100, 99, 100, 90), 30, false).flag).toBeNull();
  });

  it('does not flag a single rise', () => {
    expect(standingRise(BASELINE, readings(80, 80, 80, 120), 30, false).flag).toBeNull();
  });

  it('a null reading breaks the pair', () => {
    expect(standingRise(BASELINE, readings(100, null, 100, 90), 30, false).flag).toBeNull();
    expect(standingRise(BASELINE, readings(80, 100, null, 100), 30, false).flag).toBeNull();
  });

  it('flags a pair at minutes 3 and 5 between inconclusive readings', () => {
    expect(standingRise(BASELINE, readings(null, 100, 100, null), 30, false).flag).toBe('largeRise');
  });
});

describe('DSP-16 completed protocol', () => {
  it('is complete with all four readings in order', () => {
    const outcome = standingRise(BASELINE, readings(100, 100, 100, 100), 30, false);
    expect(outcome.completed).toBe(true);
  });

  it('is complete with all four slots attempted even when some are inconclusive', () => {
    const outcome = standingRise(BASELINE, readings(null, null, null, null), 30, false);
    expect(outcome.completed).toBe(true);
    expect(outcome.flag).toBeNull();
  });

  it('gives no flag but still shows rises when stopped early without a faint tap', () => {
    const outcome = standingRise(BASELINE, readings(100, 100), 30, false);
    expect(outcome.completed).toBe(false);
    expect(outcome.flag).toBeNull();
    expect(outcome.rises).toEqual([
      { minute: 1, riseBpm: 30 },
      { minute: 3, riseBpm: 30 },
    ]);
  });

  it('reports stoppedFaint as passed, so the UI can open the safety path', () => {
    expect(standingRise(BASELINE, readings(80), 30, true).stoppedFaint).toBe(true);
    expect(standingRise(BASELINE, readings(80), 30, false).stoppedFaint).toBe(false);
  });

  // stoppedFaint means the faint tap ended the test early, so the slot count does not override it.
  it('a faint stop with four slots follows the faint rule', () => {
    withFaintRule(false, () => {
      const outcome = standingRise(BASELINE, readings(80, 80, 100, 100), 30, true);
      expect(outcome.completed).toBe(false);
      expect(outcome.flag).toBeNull();
    });
    withFaintRule(true, () => {
      const outcome = standingRise(BASELINE, readings(80, 80, 100, 100), 30, true);
      expect(outcome.completed).toBe(true);
      expect(outcome.flag).toBe('largeRise');
    });
  });
});

describe('DSP-16 "I feel faint" stop, strict (shipped: flagPairBeforeFaintStop false)', () => {
  it('ships the strict value', () => {
    expect(DSP_CONFIG.dsp16.flagPairBeforeFaintStop).toBe(false);
  });

  it('gives no flag for a pair met before the stop, but still shows the rises', () => {
    withFaintRule(false, () => {
      const outcome = standingRise(BASELINE, readings(100, 100), 30, true);
      expect(outcome.completed).toBe(false);
      expect(outcome.flag).toBeNull();
      expect(outcome.rises).toEqual([
        { minute: 1, riseBpm: 30 },
        { minute: 3, riseBpm: 30 },
      ]);
    });
  });

  it('a stop before any standing reading is incomplete with no rises', () => {
    withFaintRule(false, () => {
      expect(standingRise(BASELINE, [], 30, true)).toEqual({
        thresholdBpm: 30,
        rises: [],
        flag: null,
        completed: false,
        stoppedFaint: true,
      });
    });
  });
});

describe('DSP-16 "I feel faint" stop, if H-043 chooses flagPairBeforeFaintStop true', () => {
  it('keeps a pair met before the stop', () => {
    withFaintRule(true, () => {
      const outcome = standingRise(BASELINE, readings(100, 100), 30, true);
      expect(outcome.completed).toBe(true);
      expect(outcome.flag).toBe('largeRise');
    });
  });

  it('does not flag when the stop comes before a pair is met', () => {
    withFaintRule(true, () => {
      const outcome = standingRise(BASELINE, readings(100), 30, true);
      expect(outcome.completed).toBe(true);
      expect(outcome.flag).toBeNull();
    });
  });

  it('still gives no flag for a test left without a faint tap', () => {
    withFaintRule(true, () => {
      const outcome = standingRise(BASELINE, readings(100, 100), 30, false);
      expect(outcome.completed).toBe(false);
      expect(outcome.flag).toBeNull();
    });
  });
});

describe('DSP-16 input checks', () => {
  it('rejects out-of-order, skipped, duplicate, or extra minutes', () => {
    const bad: StandingReading[][] = [
      [
        { minute: 3, bpm: 100 },
        { minute: 1, bpm: 100 },
      ],
      [
        { minute: 1, bpm: 100 },
        { minute: 5, bpm: 100 },
      ],
      [
        { minute: 1, bpm: 100 },
        { minute: 1, bpm: 100 },
      ],
      [...readings(100, 100, 100, 100), { minute: 10, bpm: 100 }],
    ];
    for (const standing of bad) expect(() => standingRise(BASELINE, standing, 30, false)).toThrow(RangeError);
  });

  it('rejects a baseline or reading that is not a finite positive rate', () => {
    for (const baseline of [Number.NaN, Number.POSITIVE_INFINITY, 0, -70])
      expect(() => standingRise(baseline, readings(100, 100), 30, false)).toThrow(RangeError);
    for (const bpm of [Number.NaN, Number.NEGATIVE_INFINITY, 0, -5])
      expect(() => standingRise(BASELINE, readings(100, bpm), 30, false)).toThrow(RangeError);
  });
});
