import { DSP_CONFIG, standingRise, type StandingMinute, type StandingReading } from '../../src';

// Red team for §10 DSP-16, the §10.1 "Large rise on standing" rule, and ADR 0063. The pair oracle below is
// written from the spec text: flag iff the protocol is complete and two ADJACENT attempted slots both have
// HR − baseline ≥ threshold (a null slot is attempted but inconclusive, so it breaks adjacency, ADR 0063 item 1).

const MINUTES: StandingMinute[] = [1, 3, 5, 10];
const BASELINE = 70;
const ADULT_AGE = 30;
const TEEN_AGE = 15;

// Runs the block with flagPairBeforeFaintStop set, then restores the shipped value (owner decision H-043).
function withFaintRule(flagPairBeforeFaintStop: boolean, block: () => void) {
  const shipped = DSP_CONFIG.dsp16.flagPairBeforeFaintStop;
  DSP_CONFIG.dsp16.flagPairBeforeFaintStop = flagPairBeforeFaintStop;
  try {
    block();
  } finally {
    DSP_CONFIG.dsp16.flagPairBeforeFaintStop = shipped;
  }
}

function slots(...bpms: (number | null)[]): StandingReading[] {
  return bpms.map((bpm, index) => ({ minute: MINUTES[index]!, bpm }));
}

// The next double below x (x > 0). The rate, not the rise, is stepped down: 70 + nextDown(30) rounds back to 100.
function nextDown(x: number): number {
  const bits = new BigInt64Array(new Float64Array([x]).buffer);
  bits[0] = bits[0]! - 1n;
  return new Float64Array(bits.buffer)[0]!;
}

type Level = 'below' | 'at' | 'above' | 'null';
const LEVELS: Level[] = ['below', 'at', 'above', 'null'];

function rateFor(level: Level, thresholdBpm: number): number | null {
  if (level === 'null') return null;
  if (level === 'below') return nextDown(BASELINE + thresholdBpm);
  if (level === 'at') return BASELINE + thresholdBpm;
  return BASELINE + thresholdBpm + 25;
}

function oracleFlag(levels: Level[], complete: boolean): boolean {
  if (!complete) return false;
  const high = levels.map((level) => level === 'at' || level === 'above');
  return high.some((isHigh, index) => isHigh && high[index + 1] === true);
}

// Every pattern of n slots over the four levels.
function patterns(n: number): Level[][] {
  if (n === 0) return [[]];
  return patterns(n - 1).flatMap((prefix) => LEVELS.map((level) => [...prefix, level]));
}

describe('DSP-16 red team: exhaustive pair oracle', () => {
  const bands = [
    { age: TEEN_AGE, thresholdBpm: 40 },
    { age: 19, thresholdBpm: 40 },
    { age: 20, thresholdBpm: 30 },
    { age: ADULT_AGE, thresholdBpm: 30 },
  ];

  it.each(bands)('age $age: all 256 four-slot patterns match the oracle', ({ age, thresholdBpm }) => {
    for (const levels of patterns(4)) {
      const outcome = standingRise(
        BASELINE,
        slots(...levels.map((level) => rateFor(level, thresholdBpm))),
        age,
        false,
      );
      expect({ levels, flag: outcome.flag, completed: outcome.completed }).toEqual({
        levels,
        flag: oracleFlag(levels, true) ? 'largeRise' : null,
        completed: true,
      });
      expect(outcome.thresholdBpm).toBe(thresholdBpm);
    }
  });

  it.each(bands)(
    'age $age: every prefix of 0-3 slots without a faint stop never flags',
    ({ age, thresholdBpm }) => {
      for (const n of [0, 1, 2, 3]) {
        for (const levels of patterns(n)) {
          const outcome = standingRise(
            BASELINE,
            slots(...levels.map((level) => rateFor(level, thresholdBpm))),
            age,
            false,
          );
          expect({ levels, flag: outcome.flag, completed: outcome.completed }).toEqual({
            levels,
            flag: null,
            completed: false,
          });
        }
      }
    },
  );

  it('strict faint rule: a faint stop after 0-3 slots never flags, every pattern', () => {
    withFaintRule(false, () => {
      for (const n of [0, 1, 2, 3]) {
        for (const levels of patterns(n)) {
          const outcome = standingRise(
            BASELINE,
            slots(...levels.map((level) => rateFor(level, 30))),
            ADULT_AGE,
            true,
          );
          expect({
            levels,
            flag: outcome.flag,
            completed: outcome.completed,
            faint: outcome.stoppedFaint,
          }).toEqual({
            levels,
            flag: null,
            completed: false,
            faint: true,
          });
        }
      }
    });
  });

  it('proposed faint rule: a faint stop after 0-4 slots keeps a pair met before it, every pattern', () => {
    withFaintRule(true, () => {
      for (const n of [0, 1, 2, 3, 4]) {
        for (const levels of patterns(n)) {
          const outcome = standingRise(
            BASELINE,
            slots(...levels.map((level) => rateFor(level, 30))),
            ADULT_AGE,
            true,
          );
          expect({ levels, flag: outcome.flag, completed: outcome.completed }).toEqual({
            levels,
            flag: oracleFlag(levels, true) ? 'largeRise' : null,
            completed: true,
          });
        }
      }
    });
    expect(DSP_CONFIG.dsp16.flagPairBeforeFaintStop).toBe(false);
  });
});

describe('DSP-16 red team: numeric edges', () => {
  it.each([NaN, Infinity, -Infinity, 0, -0, -70])('rejects baseline %p', (baselineBpm) => {
    expect(() => standingRise(baselineBpm, slots(100, 100, 100, 100), ADULT_AGE, false)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity, 0, -0, -100])(
    'rejects standing rate %p in every slot position',
    (bad) => {
      for (let slot = 0; slot < 4; slot++) {
        const bpms: (number | null)[] = [100, 100, 100, 100];
        bpms[slot] = bad;
        expect(() => standingRise(BASELINE, slots(...bpms), ADULT_AGE, false)).toThrow(RangeError);
      }
    },
  );

  it('a rise one ulp below the threshold does not flag; exactly the threshold does', () => {
    for (const [age, thresholdBpm] of [
      [ADULT_AGE, 30],
      [TEEN_AGE, 40],
    ] as const) {
      const short = nextDown(BASELINE + thresholdBpm);
      expect(short - BASELINE).toBeLessThan(thresholdBpm);
      expect(standingRise(BASELINE, slots(short, short, short, short), age, false).flag).toBeNull();
      const exact = BASELINE + thresholdBpm;
      expect(standingRise(BASELINE, slots(exact, exact, exact, exact), age, false).flag).toBe('largeRise');
    }
  });

  it('the physiological extremes 30 and 220 bpm compute the rise without overflow or rounding', () => {
    const fromLow = standingRise(30, slots(60, 60, 59.999, 60), ADULT_AGE, false);
    expect(fromLow.rises.map((rise) => rise.riseBpm)).toEqual([30, 30, 59.999 - 30, 30]);
    expect(fromLow.flag).toBe('largeRise');
    const fromHigh = standingRise(220, slots(220, 249, 220, 249), ADULT_AGE, false);
    expect(fromHigh.rises.map((rise) => rise.riseBpm)).toEqual([0, 29, 0, 29]);
    expect(fromHigh.flag).toBeNull();
  });

  it('subnormal and 1e308 inputs are finite rates and give finite rises', () => {
    const tiny = standingRise(5e-324, slots(5e-324, 5e-324, 5e-324, 5e-324), ADULT_AGE, false);
    expect(tiny.rises.every((rise) => rise.riseBpm === 0)).toBe(true);
    expect(tiny.flag).toBeNull();
    const huge = standingRise(1e308, slots(1.7e308, 1.7e308, 1e308, 1e308), ADULT_AGE, false);
    expect(huge.rises.every((rise) => Number.isFinite(rise.riseBpm))).toBe(true);
    expect(huge.flag).toBe('largeRise');
  });
});

describe('DSP-16 red team: ages', () => {
  it.each([
    [13, 40],
    [19, 40],
    [20, 30],
    [120, 30],
  ])('age %p uses a %p bpm threshold', (age, thresholdBpm) => {
    expect(standingRise(BASELINE, [], age, false).thresholdBpm).toBe(thresholdBpm);
  });

  it.each([12.999, 12, 0, -1, -0, 19.5, 13.000001, NaN, Infinity, -Infinity])(
    'age %p throws RangeError',
    (age) => {
      expect(() => standingRise(BASELINE, [], age, false)).toThrow(RangeError);
    },
  );

  it('a string-typed age from untyped JS throws instead of being coerced', () => {
    expect(() => standingRise(BASELINE, [], '25' as unknown as number, false)).toThrow(RangeError);
    expect(() => standingRise(BASELINE, [], '15' as unknown as number, false)).toThrow(RangeError);
  });
});

describe('DSP-16 red team: array shapes', () => {
  it('an empty array is incomplete with no rises and no flag', () => {
    expect(standingRise(BASELINE, [], ADULT_AGE, false)).toEqual({
      thresholdBpm: 30,
      rises: [],
      flag: null,
      completed: false,
      stoppedFaint: false,
    });
  });

  it.each([
    [
      'gap 1, 5',
      [
        { minute: 1, bpm: 110 },
        { minute: 5, bpm: 110 },
      ],
    ],
    [
      'duplicate 1, 1',
      [
        { minute: 1, bpm: 110 },
        { minute: 1, bpm: 110 },
      ],
    ],
    [
      'out of order 3, 1',
      [
        { minute: 3, bpm: 110 },
        { minute: 1, bpm: 110 },
      ],
    ],
    ['string minute "1"', [{ minute: '1', bpm: 110 }]],
    ['float minute 1.5', [{ minute: 1.5, bpm: 110 }]],
    ['fifth slot', [...slots(110, 110, 110, 110), { minute: 10, bpm: 110 }]],
    ['string rate "110"', [{ minute: 1, bpm: '110' }]],
    ['undefined rate', [{ minute: 1 }]],
  ])('rejects %s', (_label, standing) => {
    expect(() => standingRise(BASELINE, standing as unknown as StandingReading[], ADULT_AGE, false)).toThrow(
      RangeError,
    );
  });

  it('accepts minute 3.0 (the same double as 3), extra keys, and a frozen array', () => {
    const frozen = Object.freeze(
      [1, 3.0, 5, 10].map((minute) => Object.freeze({ minute, bpm: 110, note: 'extra' })),
    ) as unknown as StandingReading[];
    const outcome = standingRise(BASELINE, frozen, ADULT_AGE, false);
    expect(outcome.flag).toBe('largeRise');
    expect(outcome.rises).toEqual(MINUTES.map((minute) => ({ minute, riseBpm: 40 })));
  });

  it('null bpm in every position: completed, no flag, rises all null', () => {
    const outcome = standingRise(BASELINE, slots(null, null, null, null), ADULT_AGE, false);
    expect(outcome).toMatchObject({ completed: true, flag: null });
    expect(outcome.rises.map((rise) => rise.riseBpm)).toEqual([null, null, null, null]);
  });

  // FAILS at 72c6f13: a hole skips the forEach validation, then the pair loop destructures undefined and throws
  // TypeError. ADR 0063 item 4: a skipped slot throws RangeError.
  it.each([0, 1, 2, 3])('a sparse array with a hole at index %p throws RangeError', (hole) => {
    const sparse = slots(110, 110, 110, 110);
    delete sparse[hole];
    expect(() => standingRise(BASELINE, sparse, ADULT_AGE, false)).toThrow(RangeError);
  });

  // FAILS at 72c6f13: bpm is read to validate (null skips the check) and again to compute, so a getter or
  // Proxy that changes between reads puts an unvalidated NaN into rises. Expected: each field is read once,
  // so every rise is null or finite, or the call throws RangeError.
  it('a bpm getter that reads null at validation, then NaN, cannot put NaN in rises', () => {
    let reads = 0;
    const shifty = {
      minute: 1 as const,
      get bpm() {
        reads++;
        return reads === 1 ? null : NaN;
      },
    };
    const standing = [
      shifty,
      ...slots(110, 110, 110).map((reading, index) => ({ ...reading, minute: MINUTES[index + 1]! })),
    ];
    let outcome;
    try {
      outcome = standingRise(BASELINE, standing, ADULT_AGE, false);
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      return;
    }
    expect(outcome.rises.every((rise) => rise.riseBpm === null || Number.isFinite(rise.riseBpm))).toBe(true);
  });

  // FAILS at 72c6f13: same double read for minute; a Proxy element reports minute 1 to validation, then 7.
  it('a Proxy element whose minute changes after validation cannot put minute 7 in rises', () => {
    let minuteReads = 0;
    const base = { minute: 1, bpm: 110 };
    const shifty = new Proxy(base, {
      get(target, key) {
        if (key === 'minute') return ++minuteReads === 1 ? 1 : 7;
        return target[key as keyof typeof target];
      },
    }) as unknown as StandingReading;
    const standing = [shifty, ...slots(110, 110, 110, 110).slice(1)];
    let outcome;
    try {
      outcome = standingRise(BASELINE, standing, ADULT_AGE, false);
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      return;
    }
    expect(outcome.rises.map((rise) => rise.minute)).toEqual(MINUTES);
  });
});

describe('DSP-16 red team: stoppedFaint', () => {
  it.each([0, 1, 2, 3])(
    'strict rule: faint after %p slots with every slot high is incomplete, no flag',
    (n) => {
      withFaintRule(false, () => {
        const outcome = standingRise(BASELINE, slots(...Array<number>(n).fill(130)), ADULT_AGE, true);
        expect(outcome).toMatchObject({ completed: false, flag: null, stoppedFaint: true });
        expect(outcome.rises).toHaveLength(n);
      });
    },
  );

  it.each([0, 1, 2, 3, 4])('proposed rule: faint after %p slots, all high, flags iff a pair exists', (n) => {
    withFaintRule(true, () => {
      const outcome = standingRise(BASELINE, slots(...Array<number>(n).fill(130)), ADULT_AGE, true);
      expect(outcome).toMatchObject({
        completed: true,
        flag: n >= 2 ? 'largeRise' : null,
        stoppedFaint: true,
      });
    });
  });

  it('withFaintRule restores the shipped strict value even when the block throws', () => {
    expect(() =>
      withFaintRule(true, () => {
        throw new Error('block failed');
      }),
    ).toThrow('block failed');
    expect(DSP_CONFIG.dsp16.flagPairBeforeFaintStop).toBe(false);
  });
});

describe('DSP-16 red team: mutation', () => {
  it('does not mutate its input or DSP_CONFIG', () => {
    const standing = slots(110, null, 115, 120);
    const before = structuredClone(standing);
    const configBefore = structuredClone(DSP_CONFIG.dsp16);
    const outcome = standingRise(BASELINE, standing, ADULT_AGE, true);
    expect(standing).toEqual(before);
    expect(DSP_CONFIG.dsp16).toEqual(configBefore);
    expect(outcome.rises).not.toBe(standing);
    outcome.rises.forEach((rise, index) => expect(rise).not.toBe(standing[index]));
  });

  it('works on a deeply frozen input and does not depend on call order', () => {
    const standing = Object.freeze(slots(110, 110, 60, 60).map((reading) => Object.freeze(reading)));
    const first = standingRise(BASELINE, standing as StandingReading[], ADULT_AGE, false);
    standingRise(BASELINE, slots(60, 60, 110, 110), TEEN_AGE, true);
    expect(standingRise(BASELINE, standing as StandingReading[], ADULT_AGE, false)).toEqual(first);
  });
});
