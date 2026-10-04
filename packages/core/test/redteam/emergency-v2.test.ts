// Red team v2 for SAFE-1 (spec §10.1 Emergency screen, ADR 0076) at c53b913: the rolling HR, the 6 s
// bridge, withoutSqiNet, and the margins. Every signal goes through analyzeReading unless the test says
// "intervals". N1–N5 are the findings fixed after it; each states the safe behaviour. Upstream limits
// U1–U6 (red team v1), and tradeoff T1 (dicrotic double detection, U1), are not repeated here.
import {
  analyzeReading,
  emergencyHeartRate,
  readingOutcome,
  type BeatInterval,
  type ReadingAnalysis,
  type ReadingContext,
} from '../../src';
import { captureAt, regularOffsets, type SyntheticCapture } from '../synthetic';
import { beatTimes, beatTrain, seededNormal, type Channels } from './attacks';

const CONTEXT: ReadingContext = {
  captureFps: 30,
  tier: 'basic',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};

const SLOW_TEST_MS = 120_000;

function regular(bpm: number, seconds: number, dicroticRatio = 0.3): Channels {
  return beatTrain(beatTimes([60 / bpm], seconds), dicroticRatio);
}

function analyze(
  channels: Channels,
  seconds: number,
  context: Partial<ReadingContext> = {},
): ReadingAnalysis {
  const fps = context.captureFps ?? 30;
  return analyzeReading(captureAt(regularOffsets(fps, seconds), channels), { ...CONTEXT, ...context });
}

// Gaussian red noise of this SD (the pulse is 0.006), from a seeded draw so a failure reproduces.
function noisy(channels: Channels, sd: number, seed: number): Channels {
  const noise = seededNormal(seed);
  return (tS) => {
    const frame = channels(tS);
    return { ...frame, r: frame.r + sd * noise() };
  };
}

// Regular beats where every `every`-th beat (from the first) has `ratio` × the amplitude; below ~0.2 the
// detector drops it (DSP-9 "not a beat"), so the interval across it is doubled, accepted, and clean.
function weakEvery(bpm: number, every: number, ratio: number, seconds: number): Channels {
  const times = beatTimes([60 / bpm], seconds);
  const pulse = (tS: number, beatS: number) => {
    const x = tS - beatS;
    return Math.exp(-0.5 * ((x - 0.12) / 0.07) ** 2) + 0.3 * Math.exp(-0.5 * ((x - 0.4) / 0.07) ** 2);
  };
  return (tS) => {
    let volume = 0;
    times.forEach((beatS, k) => {
      volume += (k % every === 0 ? ratio : 1) * pulse(tS, beatS);
    });
    return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
  };
}

// SQI-Net windows (1 s ticks, the first ending at 4 s) with pClean from the window's end second.
function sqiWindows(capture: SyntheticCapture, seconds: number, pCleanAt: (endS: number) => number) {
  const firstNs = capture.samples[0]!.tNs;
  return Array.from({ length: seconds - 3 }, (_, k) => ({
    endNs: firstNs + (k + 4) * 1e9,
    pClean: pCleanAt(k + 4),
  }));
}

// A real analysis whose intervals a test replaces; emergencyHeartRate reads intervals, rejectedSpans,
// startNs, heartRateBpm, and the rest flag.
const BASE = analyze(regular(72, 20), 20);

function withIntervals(intervals: BeatInterval[]): ReadingAnalysis {
  return { ...BASE, durationS: 9999, rejectedSpans: [], intervals, heartRateBpm: 170 };
}

// Intervals laid end to end from 1 s, cycling through intervalsMs, for totalS.
function cyclingIntervals(intervalsMs: number[], totalS: number): BeatInterval[] {
  const intervals: BeatInterval[] = [];
  let atNs = BASE.startNs + 1e9;
  for (let k = 0; atNs < BASE.startNs + (1 + totalS) * 1e9; k++) {
    const ibiMs = intervalsMs[k % intervalsMs.length]!;
    atNs += ibiMs * 1e6;
    intervals.push({ tNs: atNs, ibiMs, accepted: true, nn: true });
  }
  return intervals;
}

// Clean runs of chunkS of ibiMs intervals with a gap of gapS (no intervals) between runs, until
// totalCleanS of intervals.
function chunkedIntervals(ibiMs: number, chunkS: number, gapS: number, totalCleanS: number): BeatInterval[] {
  const intervals: BeatInterval[] = [];
  let endNs = BASE.startNs + 1e9;
  let cleanMs = 0;
  let chunkMs = 0;
  while (cleanMs < totalCleanS * 1000) {
    if (chunkMs + ibiMs > chunkS * 1000) {
      endNs += Math.round(gapS * 1e9);
      chunkMs = 0;
    }
    endNs += ibiMs * 1e6;
    chunkMs += ibiMs;
    cleanMs += ibiMs;
    intervals.push({ tNs: endNs, ibiMs, accepted: true, nn: true });
  }
  return intervals;
}

const fastFromIntervals = (intervals: BeatInterval[]) =>
  emergencyHeartRate(withIntervals(intervals))?.fastSustained ?? false;

describe('red team v2 SAFE-1: the two-beat span keeps what it fixed', () => {
  it.each([
    ['trigeminy 160 bpm, coupling 0.7 RR, full compensation', [0.375, 0.2625, 0.4875]],
    ['period 3, 300/420/420 ms (157.9 bpm mean, DSP-11 reads 144)', [0.3, 0.42, 0.42]],
    ['period 3, 340/340/460 ms (157.9 bpm mean)', [0.34, 0.34, 0.46]],
  ])('%s, 95 s: fastSustained', (_name, intervalsS) => {
    expect(emergencyHeartRate(analyze(beatTrain(beatTimes(intervalsS, 95)), 95))?.fastSustained).toBe(true);
  });

  it('irregular 350 ± 40 ms (AF-like, 171 bpm, seed 3), 95 s: fastSustained', () => {
    const draw = seededNormal(3);
    const times: number[] = [];
    for (let tS = -2; tS < 97; tS += Math.max(0.26, 0.35 + 0.04 * draw())) times.push(tS);
    expect(emergencyHeartRate(analyze(beatTrain(times), 95))?.fastSustained).toBe(true);
  });

  it.each([
    [165, 0.002],
    [180, 0.0015],
  ])(
    '%i bpm with red noise SD %f, seeds 1–8, 95 s: fastSustained on at least 7 of 8',
    (bpm, sd) => {
      const fired = [1, 2, 3, 4, 5, 6, 7, 8].filter(
        (seed) => emergencyHeartRate(analyze(noisy(regular(bpm, 95), sd, seed), 95))?.fastSustained,
      );
      expect(fired.length).toBeGreaterThanOrEqual(7);
    },
    SLOW_TEST_MS,
  );
});

describe('red team v2 SAFE-1: margins and boundaries', () => {
  it.each([
    [149.99, 30],
    [150.01, 30],
    [149.99, 240],
    [150.01, 240],
  ])(
    '%f bpm regular at %i fps: not urgent (fastBpm + fastMarginBpm is 150.01, strict)',
    (bpm, fps) => {
      expect(emergencyHeartRate(analyze(regular(bpm, 75), 75, { captureFps: fps }))).toBeNull();
    },
    SLOW_TEST_MS,
  );

  it.each([
    [150.02, 30],
    [150.05, 60],
    [150.02, 240],
  ])(
    '%f bpm regular at %i fps: fastSustained',
    (bpm, fps) => {
      expect(emergencyHeartRate(analyze(regular(bpm, 75), 75, { captureFps: fps }))?.fastSustained).toBe(
        true,
      );
    },
    SLOW_TEST_MS,
  );

  it.each([
    [39.99, true],
    [40.01, false],
  ])('%f bpm regular for 95 s: slowBelow40 is %s', (bpm, slow) => {
    expect(emergencyHeartRate(analyze(regular(bpm, 95), 95))?.slowBelow40 ?? false).toBe(slow);
  });

  it.each([
    [170, 70, 'fastSustained'],
    [35, 40, 'slowBelow40'],
  ] as const)(
    '%i bpm for %i s on a Full Scan: inconclusive and still carries urgent.%s',
    (bpm, seconds, field) => {
      const outcome = readingOutcome(analyze(regular(bpm, seconds), seconds));
      expect(outcome.kind).toBe('inconclusive');
      expect(outcome.urgent?.[field]).toBe(true);
    },
  );
});

describe('red team v2 SAFE-1: the 6 s bridge', () => {
  // 352 ms intervals (170.5 bpm). Bridged breaks are not counted: 70 clean s in 1 s runs takes ~480 s of
  // wall time, and still fires. Recorded as the ADR's reading of "sustained 60 s" (clean seconds), not a
  // finding.
  it.each([1, 2, 5, 20])(
    'intervals: %i s clean runs between 5.9 s breaks, 70 clean s: fastSustained',
    (chunkS) => {
      expect(fastFromIntervals(chunkedIntervals(352, chunkS, 5.9, 70))).toBe(true);
    },
  );

  it.each([5, 20])('intervals: %i s clean runs between 6.1 s breaks, 70 clean s: not fast', (chunkS) => {
    expect(fastFromIntervals(chunkedIntervals(352, chunkS, 6.1, 70))).toBe(false);
  });

  it('intervals: 9.9 s clean runs between 6.1 s breaks, 120 clean s: no run reaches its first window', () => {
    expect(fastFromIntervals(chunkedIntervals(352, 9.9, 6.1, 120))).toBe(false);
  });
});

describe('red team v2 SAFE-1: withoutSqiNet', () => {
  // Motion 10–13 s; clipping 20–22 s, a broken frame stat at 60–61 s, an exposure change at 65 s; a 4 s
  // flat stretch at 40 s; dropped frames at 30 s (200 ms) and 50 s (400 ms); cold hands 70–72 s; SQI-Net
  // rejects some windows and leaves every 7th unscored.
  it.each([0, 1, 2, 3, 4, 5])(
    'trial %i: withoutSqiNet equals the sqi: null analysis, spans in the same order',
    (trial) => {
      const seconds = 80;
      const draw = seededNormal(21 + trial);
      const offsets = regularOffsets(30, seconds).filter(
        (tS) => trial % 2 === 0 || !((tS > 30 && tS < 30.2) || (tS > 50 && tS < 50.4)),
      );
      const pulse = regular(150 + 10 * trial, seconds);
      const capture = captureAt(offsets, (tS) => {
        const frame = pulse(tS);
        return { ...frame, r: trial >= 3 && tS > 40 && tS < 44 ? 0.6 : frame.r + 0.001 * draw() };
      });
      const firstNs = capture.samples[0]!.tNs;
      if (trial >= 2)
        capture.stats.forEach((stat) => {
          const tS = (stat.tNs - firstNs) / 1e9;
          if (tS > 20 && tS < 22) stat.clipFrac = 0.5;
          if (tS > 60 && tS < 61) stat.spatialStdR = 5;
          if (tS > 65) stat.exposureNs = 9_000_000;
        });
      const context: ReadingContext = {
        ...CONTEXT,
        motionSpans: trial >= 1 ? [{ startNs: firstNs + 10e9, endNs: firstNs + 13e9 }] : [],
        coldHandsSpans: trial >= 4 ? [{ startNs: firstNs + 70e9, endNs: firstNs + 72e9 }] : [],
      };
      const windows = sqiWindows(capture, seconds, () => (draw() > 0 ? 0.9 : 0.2)).filter(
        (_, k) => k % 7 !== 3,
      );
      const plain = analyzeReading(capture, context);
      const scored = analyzeReading(capture, { ...context, sqi: { threshold: 0.5, windows } });
      expect(scored.withoutSqiNet).toEqual({
        intervals: plain.intervals,
        rejectedSpans: plain.rejectedSpans,
      });
      expect(emergencyHeartRate(scored)).toEqual(emergencyHeartRate(plain));
    },
    SLOW_TEST_MS,
  );

  it('170 bpm for 75 s with every SQI-Net window rejected: inconclusive, urgent.fastSustained', () => {
    const capture = captureAt(regularOffsets(30, 75), regular(170, 75));
    const windows = sqiWindows(capture, 75, () => 0.1);
    const outcome = readingOutcome(analyzeReading(capture, { ...CONTEXT, sqi: { threshold: 0.5, windows } }));
    expect(outcome).toMatchObject({ kind: 'inconclusive', urgent: { fastSustained: true } });
  });

  // Measured 745 ms with sqi null and 664 ms with SQI-Net (DSP-9 twice) on this PC; the bound only catches a
  // blow-up.
  it(
    '300 s at 240 fps, 170 bpm, every 5th SQI-Net window rejected: classing twice costs < 2× sqi null',
    () => {
      const capture = captureAt(regularOffsets(240, 300), regular(170, 300));
      const windows = sqiWindows(capture, 300, (endS) => (endS % 5 === 0 ? 0.1 : 0.9));
      const context = { ...CONTEXT, captureFps: 240 };
      let startedMs = Date.now();
      analyzeReading(capture, context);
      const plainMs = Date.now() - startedMs;
      startedMs = Date.now();
      const scored = analyzeReading(capture, { ...context, sqi: { threshold: 0.5, windows } });
      const scoredMs = Date.now() - startedMs;
      expect(emergencyHeartRate(scored)?.fastSustained).toBe(true);
      expect(scoredMs).toBeLessThan(2 * plainMs + 500);
    },
    SLOW_TEST_MS,
  );
});

describe('red team v2 SAFE-1 findings N1–N5, fixed', () => {
  // N1 (high). At c53b913 every beat missed by the detector doubled one interval and so spoiled two
  // two-beat spans, so once ≥ ~25% of intervals crossed a missed beat the median span was a doubled one
  // and the rolling HR dropped to two-thirds, while DSP-11's median interval read > 150 for 95 clean
  // seconds. Seeds 1–8 at 30 fps: 200 bpm SD 0.0015 fired 0/8 at c53b913, 7/8 at 6c49727.
  it.each([
    [200, 0.0015, 1],
    [200, 0.0015, 2],
    [180, 0.002, 1],
    [180, 0.002, 2],
  ])('N1 %i bpm with red noise SD %f (seed %i), 95 s: DSP-11 HR > 150 and fastSustained', (bpm, sd, seed) => {
    const analysis = analyze(noisy(regular(bpm, 95), sd, seed), 95);
    expect(analysis.heartRateBpm!).toBeGreaterThan(165);
    expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
  });

  it.each([
    [160, 4],
    [170, 4],
    [160, 5],
    [170, 5],
  ])(
    'N1 %i bpm with every %i-th beat at 0.1 × the amplitude (not detected), 95 s: fastSustained',
    (bpm, every) => {
      const analysis = analyze(weakEvery(bpm, every, 0.1, 95), 95);
      expect(analysis.heartRateBpm!).toBeGreaterThan(155);
      expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
    },
  );

  it('N1 intervals: 375/375/375/750 ms for 300 s (160 bpm, every 4th beat missed): fastSustained', () => {
    expect(fastFromIntervals(cyclingIntervals([375, 375, 375, 750], 300))).toBe(true);
  });

  // N2 (medium). Two-beat spans fixed period 2 only. Period 4 (three short, one long) has two span values
  // in unequal counts per 15 s window, so their median flipped as F1 did; period 3 (two short, one long)
  // put it on short + long. Mean rates 154.6–155.2 bpm, DSP-11 176–182.
  it.each([[[330, 330, 330, 560]], [[330, 330, 500]], [[353, 282, 529]]])(
    'N2 intervals: %j ms cycled for 300 s (mean > 154 bpm): fastSustained',
    (intervalsMs) => {
      expect(fastFromIntervals(cyclingIntervals(intervalsMs, 300))).toBe(true);
    },
  );

  it.each([
    ['330/330/500 ms', [0.33, 0.33, 0.5]],
    ['trigeminy 170 bpm, coupling 0.8 RR, pause 1.5 RR', [0.353, 0.282, 0.529]],
  ])('N2 %s for 95 s through the pipeline: fastSustained', (_name, intervalsS) => {
    const analysis = analyze(beatTrain(beatTimes(intervalsS, 95)), 95);
    expect(analysis.heartRateBpm!).toBeGreaterThan(170);
    expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
  });

  // N3 (medium). ADR 0076 item 2: "SQI-Net can neither raise nor suppress either field". slowBelow40 read
  // the main heartRateBpm, whose clean seconds and DSP-9 classes include SQI-Net's spans.
  it('N3 35 bpm for 95 s, every SQI-Net window rejected: slowBelow40 as with sqi null', () => {
    const capture = captureAt(regularOffsets(30, 95), regular(35, 95));
    expect(emergencyHeartRate(analyzeReading(capture, CONTEXT))?.slowBelow40).toBe(true);
    const windows = sqiWindows(capture, 95, () => 0.1);
    const scored = analyzeReading(capture, { ...CONTEXT, sqi: { threshold: 0.5, windows } });
    expect(emergencyHeartRate(scored)?.slowBelow40).toBe(true);
  });

  it('N3 36 bpm to 35 s then 46 bpm to 95 s, SQI-Net rejects after 36 s: not slowBelow40', () => {
    const times: number[] = [];
    for (let tS = -2; tS < 97; tS += tS < 35 ? 60 / 36 : 60 / 46) times.push(tS);
    const capture = captureAt(regularOffsets(30, 95), beatTrain(times));
    expect(emergencyHeartRate(analyzeReading(capture, CONTEXT))).toBeNull();
    const windows = sqiWindows(capture, 95, (endS) => (endS > 36 ? 0.1 : 0.9));
    const scored = analyzeReading(capture, { ...CONTEXT, sqi: { threshold: 0.5, windows } });
    expect(emergencyHeartRate(scored)).toBeNull();
  });

  // N4 (low). F4's rounding on the slow side: a true 40.000 bpm train measures 39.9999999999995 bpm, and
  // "< 40" had no margin, so exactly 40 asked the symptom question.
  it('N4 exactly 40 bpm regular for 95 s: not slowBelow40 (spec "< 40")', () => {
    expect(emergencyHeartRate(analyze(regular(40, 95), 95))).toBeNull();
  });

  // N5 (low). ADR 0076: "A gap ≤ 6 s is bridged". The gap was a difference of float seconds, so an exact
  // 6 s gap was bridged in 8 s runs and restarted the count in 20 s runs (352 ms intervals).
  it('N5 control: intervals in 8 s runs between exact 6 s breaks, 120 clean s: bridged, fastSustained', () => {
    expect(fastFromIntervals(chunkedIntervals(353, 8, 6, 120))).toBe(true);
  });

  it('N5 intervals: 20 s runs between exact 6 s breaks, 70 clean s: bridged, fastSustained', () => {
    expect(fastFromIntervals(chunkedIntervals(352, 20, 6, 70))).toBe(true);
  });
});
