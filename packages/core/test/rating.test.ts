import { rateDevice, tierUnlocks, type RatingCapabilities, type RatingMeasures } from '../src';

// Hand-computed cases for spec §5.1 (points) and §5.2 (tiers and unlocks), ADR 0058.

function phone(
  maxFps: number,
  locks = { exposure: true, whiteBalance: true, focus: true },
): RatingCapabilities {
  return {
    rearLenses: [{ id: 'wide', maxFps, torchUsable: true }],
    torch: { available: true },
    locks,
  };
}
const NO_LOCKS = { exposure: false, whiteBalance: false, focus: false };

function practice(overrides: Partial<RatingMeasures> = {}): RatingMeasures {
  return {
    lensId: 'wide',
    achievedFps: null,
    frameIntervalSdMs: 0.5,
    coupling: { perfusionIndexPct: 2, snrDb: 20 },
    ...overrides,
  };
}

describe('§5.1 frame rate points', () => {
  const cases: [number, number | null, number][] = [
    [240, 120, 30],
    [120, 119.5, 30], // 0.5 fps tolerance (ADR 0058)
    [120, 119.4, 24],
    [60, null, 24], // not measured: the format rate
    [60, 59.5, 24],
    [60, 59.49, 14],
    [30, 29.97, 14],
    [30, 28, 6],
    [24, 24, 6],
    [60, 30, 14], // achieved below the format: the achieved rate counts
  ];
  it.each(cases)('format %d fps, achieved %p fps: %d points', (formatFps, achievedFps, points) => {
    const rating = rateDevice(phone(formatFps), practice({ achievedFps }));
    expect(rating.components.frameRate).toBe(points);
    expect(rating.hardFail).toBeNull();
  });

  it('below 24 fps is a hard fail', () => {
    const fromFormat = rateDevice(phone(20), practice());
    expect(fromFormat.hardFail).toBe('below-24-fps');
    expect(fromFormat.tier).toBe('unsupported');
    expect(fromFormat.components.frameRate).toBe(0);
    const fromPractice = rateDevice(phone(60), practice({ achievedFps: 23.4 }));
    expect(fromPractice.hardFail).toBe('below-24-fps');
    expect(fromPractice.fpsLevel).toBeNull();
  });

  it('before lens selection, uses the fastest lens that runs with the torch', () => {
    const capabilities: RatingCapabilities = {
      rearLenses: [
        { id: 'wide', maxFps: 60, torchUsable: true },
        { id: 'ultra', maxFps: 240, torchUsable: false },
      ],
      torch: { available: true },
      locks: NO_LOCKS,
    };
    const rating = rateDevice(capabilities, {
      lensId: null,
      achievedFps: null,
      frameIntervalSdMs: null,
      coupling: null,
    });
    expect(rating.components.frameRate).toBe(24);
    expect(rating.fpsLevel).toBe(60);
    expect(rating.ambient).toBe(false);
  });

  it('throws when the selected lens is not in the probe', () => {
    expect(() => rateDevice(phone(60), practice({ lensId: 'tele' }))).toThrow('tele');
  });
});

describe('§5.1 flash-to-lens coupling points', () => {
  const cases: [number, number, number][] = [
    [1, 12, 35], // both at their full-score values
    [2.5, 30, 35], // capped at 35
    [0.8, 12, 28], // 35 × 0.8
    [2, 9, 26], // 35 × 0.75 = 26.25, floored
    [0.5, 6, 8], // 35 × 0.5 × 0.5 = 8.75, floored
    [1, -3, 0], // negative SNR scores 0, not negative points
    [0, 20, 0],
  ];
  it.each(cases)('PI %p %%, SNR %p dB: %d points', (perfusionIndexPct, snrDb, points) => {
    const rating = rateDevice(phone(60), practice({ coupling: { perfusionIndexPct, snrDb } }));
    expect(rating.components.coupling).toBe(points);
  });

  it('is null until the practice step', () => {
    const rating = rateDevice(phone(60), practice({ coupling: null }));
    expect(rating.components.coupling).toBeNull();
    expect(rating.tier).toBeNull();
    expect(rating.unlocks).toEqual([]);
    // Phone check (mockup 04): frame rate 24 + locks 15 + timing 20.
    expect(rating.score).toBe(59);
  });
});

describe('§5.1 lock points', () => {
  const cases: [RatingCapabilities['locks'], number][] = [
    [{ exposure: true, whiteBalance: true, focus: true }, 15],
    [{ exposure: true, whiteBalance: false, focus: false }, 6],
    [{ exposure: false, whiteBalance: true, focus: false }, 5],
    [{ exposure: false, whiteBalance: false, focus: true }, 4],
    [NO_LOCKS, 0],
  ];
  it.each(cases)('%p: %d points', (locks, points) => {
    expect(rateDevice(phone(60, locks), practice()).components.locks).toBe(points);
  });
});

describe('§5.1 frame timing points', () => {
  const cases: [number | null, number][] = [
    [0.99, 20],
    [1, 12],
    [2.99, 12],
    [3, 6],
    [5.99, 6],
    [6, 0],
    [null, 0], // not measured
  ];
  it.each(cases)('SD %p ms: %d points', (frameIntervalSdMs, points) => {
    expect(rateDevice(phone(60), practice({ frameIntervalSdMs })).components.timing).toBe(points);
  });
});

describe('§5.2 tiers', () => {
  // fps 120 (30) + locks 15 + timing 20 = 65 before coupling.
  it('Full at 80, Basic at 79', () => {
    const at80 = rateDevice(phone(120), practice({ coupling: { perfusionIndexPct: 0.43, snrDb: 12 } }));
    expect([at80.score, at80.tier]).toEqual([80, 'full']);
    const at79 = rateDevice(phone(120), practice({ coupling: { perfusionIndexPct: 0.42, snrDb: 12 } }));
    expect([at79.score, at79.tier]).toEqual([79, 'basic']);
  });

  it('caps a phone below 60 fps at Basic whatever the score', () => {
    // 14 + 35 + 15 + 20 = 84.
    const rating = rateDevice(phone(30), practice());
    expect([rating.score, rating.tier]).toEqual([84, 'basic']);
  });

  // fps 60 (24) + exposure lock 6 + timing 6 (SD 4 ms) = 36 before coupling.
  it('Basic at 50, Limited at 49', () => {
    const locks = { exposure: true, whiteBalance: false, focus: false };
    const at50 = rateDevice(
      phone(60, locks),
      practice({ frameIntervalSdMs: 4, coupling: { perfusionIndexPct: 0.41, snrDb: 12 } }),
    );
    expect([at50.score, at50.tier]).toEqual([50, 'basic']);
    const at49 = rateDevice(
      phone(60, locks),
      practice({ frameIntervalSdMs: 4, coupling: { perfusionIndexPct: 0.38, snrDb: 12 } }),
    );
    expect([at49.score, at49.tier]).toEqual([49, 'limited']);
  });

  it('Basic needs 30 fps', () => {
    // 6 + 35 + 15 + 20 = 76.
    const rating = rateDevice(phone(24), practice());
    expect([rating.score, rating.tier]).toEqual([76, 'limited']);
  });

  // fps 24 (6), no locks, timing 0 (SD 8 ms).
  it('Limited at 25, Not supported at 24', () => {
    const at25 = rateDevice(
      phone(24, NO_LOCKS),
      practice({ frameIntervalSdMs: 8, coupling: { perfusionIndexPct: 0.55, snrDb: 12 } }),
    );
    expect([at25.score, at25.tier]).toEqual([25, 'limited']);
    const at24 = rateDevice(
      phone(24, NO_LOCKS),
      practice({ frameIntervalSdMs: 8, coupling: { perfusionIndexPct: 0.52, snrDb: 12 } }),
    );
    expect([at24.score, at24.tier]).toEqual([24, 'unsupported']);
    expect(at24.hardFail).toBeNull();
  });

  it('ambient-light mode (coupling under 10 points) is at most Limited', () => {
    // 30 + 8 + 15 + 20 = 73 would be Basic.
    const weak = rateDevice(phone(120), practice({ coupling: { perfusionIndexPct: 0.5, snrDb: 6 } }));
    expect([weak.score, weak.ambient, weak.tier]).toEqual([73, true, 'limited']);
    // 30 + 9 + 15 + 20 = 74: 9.8 points is still under 10.
    const justUnder = rateDevice(phone(120), practice({ coupling: { perfusionIndexPct: 0.28, snrDb: 12 } }));
    expect([justUnder.components.coupling, justUnder.ambient]).toEqual([9, true]);
    // 30 + 10 + 15 + 20 = 75.
    const atTen = rateDevice(phone(120), practice({ coupling: { perfusionIndexPct: 0.29, snrDb: 12 } }));
    expect([atTen.components.coupling, atTen.ambient, atTen.tier]).toEqual([10, false, 'basic']);
  });

  it('ambient-light mode is Limited even below 25 points (§5.2, §4.6)', () => {
    // 6 + 8 = 14.
    const rating = rateDevice(
      phone(24, NO_LOCKS),
      practice({ frameIntervalSdMs: 8, coupling: { perfusionIndexPct: 0.5, snrDb: 6 } }),
    );
    expect([rating.score, rating.ambient, rating.tier, rating.hardFail]).toEqual([14, true, 'limited', null]);
  });

  it('a hard fail still wins over ambient-light mode', () => {
    const rating = rateDevice(
      { ...phone(20), torch: { available: false } },
      practice({ coupling: { perfusionIndexPct: 0.5, snrDb: 6 } }),
    );
    expect([rating.ambient, rating.hardFail, rating.tier]).toEqual([true, 'below-24-fps', 'unsupported']);
  });

  it('a phone without a usable torch is ambient-light only', () => {
    const noFlash = { ...phone(120), torch: { available: false } };
    const rating = rateDevice(noFlash, practice());
    expect([rating.score, rating.ambient, rating.tier]).toEqual([100, true, 'limited']);
    const torchOffLens: RatingCapabilities = {
      ...phone(120),
      rearLenses: [{ id: 'wide', maxFps: 120, torchUsable: false }],
    };
    expect(rateDevice(torchOffLens, practice()).tier).toBe('limited');
  });

  it('no pulse even in ambient mode after two tries is a hard fail', () => {
    const rating = rateDevice(phone(120), practice({ coupling: 'no-pulse' }));
    expect([rating.hardFail, rating.tier, rating.components.coupling]).toEqual([
      'no-pulse',
      'unsupported',
      0,
    ]);
    expect(rating.unlocks).toEqual([]);
  });
});

// The achieved-fps tolerance (H-039, owner decision pending) moves these edges; each is pinned through
// the tier or hard fail, so changing the tolerance shows up here.
describe('§5.2 tiers at the achieved-fps edges (H-039)', () => {
  it('rates a phone Full at the 60 fps level', () => {
    // 24 + 35 + 15 + 20 = 94.
    const rating = rateDevice(phone(60), practice());
    expect([rating.fpsLevel, rating.score, rating.tier]).toEqual([60, 94, 'full']);
  });

  it('Full cap: achieved 59.5 is Full, 59.49 is Basic', () => {
    const at595 = rateDevice(phone(60), practice({ achievedFps: 59.5 }));
    expect([at595.fpsLevel, at595.score, at595.tier]).toEqual([60, 94, 'full']);
    // 14 + 35 + 15 + 20 = 84.
    const at5949 = rateDevice(phone(60), practice({ achievedFps: 59.49 }));
    expect([at5949.fpsLevel, at5949.score, at5949.tier]).toEqual([30, 84, 'basic']);
  });

  it('Basic needs 30: achieved 29.5 is Basic, 29.49 is Limited', () => {
    const at295 = rateDevice(phone(30), practice({ achievedFps: 29.5 }));
    expect([at295.fpsLevel, at295.score, at295.tier]).toEqual([30, 84, 'basic']);
    // 6 + 35 + 15 + 20 = 76.
    const at2949 = rateDevice(phone(30), practice({ achievedFps: 29.49 }));
    expect([at2949.fpsLevel, at2949.score, at2949.tier]).toEqual([24, 76, 'limited']);
  });

  it('hard fail: achieved 23.5 is not one, 23.49 is', () => {
    const at235 = rateDevice(phone(24), practice({ achievedFps: 23.5 }));
    expect([at235.hardFail, at235.fpsLevel, at235.tier]).toEqual([null, 24, 'limited']);
    const at2349 = rateDevice(phone(24), practice({ achievedFps: 23.49 }));
    expect([at2349.hardFail, at2349.fpsLevel, at2349.tier]).toEqual(['below-24-fps', null, 'unsupported']);
  });
});

describe('best and worst phones', () => {
  it('best phone: 100, Full, everything unlocked', () => {
    const rating = rateDevice(
      phone(240),
      practice({ achievedFps: 120, frameIntervalSdMs: 0.2, coupling: { perfusionIndexPct: 3, snrDb: 25 } }),
    );
    expect(rating).toEqual({
      components: { frameRate: 30, coupling: 35, locks: 15, timing: 20 },
      score: 100,
      fpsLevel: 120,
      ambient: false,
      tier: 'full',
      hardFail: null,
      unlocks: tierUnlocks('full'),
    });
  });

  it('worst phone: no rear camera', () => {
    const capabilities: RatingCapabilities = { rearLenses: [], torch: { available: false }, locks: NO_LOCKS };
    const rating = rateDevice(capabilities, {
      lensId: null,
      achievedFps: null,
      frameIntervalSdMs: null,
      coupling: null,
    });
    expect(rating).toEqual({
      components: { frameRate: 0, coupling: null, locks: 0, timing: 0 },
      score: 0,
      fpsLevel: null,
      ambient: true,
      tier: 'unsupported',
      hardFail: 'no-rear-camera',
      unlocks: [],
    });
  });
});

describe('§5.2 unlocks', () => {
  it('Full unlocks every mode', () => {
    expect(tierUnlocks('full')).toEqual([
      'quickCheck',
      'rhythmFlags',
      'breathing',
      'standingTest',
      'extraBeats',
      'hrv',
      'deepHrv',
      'pulseShape',
      'diabetes',
      'fullScan',
    ]);
  });
  it('Basic has no HRV, pulse shape, or diabetes check', () => {
    expect(tierUnlocks('basic')).toEqual([
      'quickCheck',
      'rhythmFlags',
      'breathing',
      'standingTest',
      'extraBeats',
      'fullScan',
    ]);
  });
  it('Limited has Quick Check without rhythm flags', () => {
    expect(tierUnlocks('limited')).toEqual(['quickCheck']);
  });
  it('Not supported unlocks nothing (the app offers Demo mode)', () => {
    expect(tierUnlocks('unsupported')).toEqual([]);
  });
  it('a rating carries its tier unlocks', () => {
    expect(rateDevice(phone(30), practice()).unlocks).toEqual(tierUnlocks('basic'));
  });
});
