import {
  analyzeReading,
  DSP_CONFIG,
  type FrameStat,
  type ReadingAnalysis,
  type ReadingContext,
  type Sample,
} from '../src';
import { parkMillerUniforms } from './synthetic';

const CLOCK_START_NS = 5_000_000_000_000;

interface FrameOptions {
  fps?: number;
  seconds?: number;
  bpm?: number;
  breathsPerMin?: number;
  // Seconds-from-start predicates that change single frames.
  fingerOff?: (tS: number) => boolean;
  clipped?: (tS: number) => boolean;
  exposureNs?: (tS: number) => number;
  dropped?: (tS: number) => boolean;
}

interface SyntheticReading {
  samples: Sample[];
  stats: FrameStat[];
  peaksS: number[]; // true systolic peak times, seconds from the first frame
}

// −R = −0.62 + Gaussian pulses (σ 60 ms, ±20% with breathing) + a ±0.002 baseline breath; RSA 5%.
// G and B are low, so R/(G+B) ≈ 4 and the frame passes DSP-4 unless a predicate says otherwise.
function syntheticReading(options: FrameOptions = {}): SyntheticReading {
  const { fps = 60, seconds = 90, bpm = 72, breathsPerMin = 15 } = options;
  const breath = (tS: number) => Math.sin((2 * Math.PI * breathsPerMin * tS) / 60);
  const peaksS: number[] = [];
  for (let peakS = 0.7; peakS < seconds + 1; peakS += (60 / bpm) * (1 - 0.05 * breath(peakS)))
    peaksS.push(peakS);
  const noise = parkMillerUniforms(Math.round(fps * seconds), 99);
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (let k = 0; k < Math.round(fps * seconds); k++) {
    const tS = k / fps;
    if (options.dropped?.(tS)) continue;
    let pulse = 0;
    for (const peakS of peaksS)
      if (Math.abs(tS - peakS) < 0.5)
        pulse += (1 + 0.2 * breath(peakS)) * Math.exp(-0.5 * ((tS - peakS) / 0.06) ** 2);
    const off = options.fingerOff?.(tS) ?? false;
    const tNs = CLOCK_START_NS + Math.round(tS * 1e9);
    samples.push({
      tNs,
      r: off ? 0.25 : 0.62 - 0.004 * pulse - 0.002 * breath(tS) + 2e-5 * (noise[k]! - 0.5),
      g: off ? 0.22 : 0.11,
      b: off ? 0.2 : 0.04,
    });
    stats.push({
      tNs,
      spatialStdR: off ? 0.2 : 0.02,
      clipFrac: options.clipped?.(tS) ? 0.1 : 0,
      exposureNs: options.exposureNs?.(tS) ?? 8_000_000,
    });
  }
  return { samples, stats, peaksS };
}

const CONTEXT: ReadingContext = {
  captureFps: 60,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};

function analyze(reading: SyntheticReading, context: Partial<ReadingContext> = {}): ReadingAnalysis {
  return analyzeReading({ samples: reading.samples, stats: reading.stats }, { ...CONTEXT, ...context });
}

const spansOf = (analysis: ReadingAnalysis, reason: string) =>
  analysis.rejectedSpans.filter((span) => span.reason === reason);

describe('analyzeReading on a clean 90 s capture', () => {
  const reading = syntheticReading();
  const analysis = analyze(reading);
  const meanRate = (60 * (reading.peaksS.length - 1)) / (reading.peaksS.at(-1)! - reading.peaksS[0]!);

  it('rejects nothing, so every second is clean', () => {
    expect(analysis.rejectedSpans).toEqual([]);
    expect(analysis.durationS).toBeCloseTo(90 - 1 / 60, 9);
    expect(analysis.cleanSeconds).toBe(analysis.durationS);
    expect(analysis.lostSeconds).toEqual({ motion: 0, pressure: 0, coverage: 0, coldHands: 0 });
    expect(analysis.sqiAvailable).toBe(false);
  });

  it('finds every beat and reads the heart rate, breathing rate, and perfusion index', () => {
    const inside = reading.peaksS.filter((peakS) => peakS > 0.5 && peakS < 89.5);
    const kept = analysis.segments.flat().filter((beat) => beat.beatClass !== 'not-a-beat');
    expect(Math.abs(kept.length - inside.length)).toBeLessThanOrEqual(2);
    expect(Math.abs(analysis.heartRateBpm! - meanRate)).toBeLessThan(1);
    expect(Math.abs(analysis.breathing!.rateBrpm! - 15)).toBeLessThanOrEqual(0.25);
    // Pulse peak-to-foot ≈ 0.004 on a 0.62 red level: about 0.65%.
    expect(analysis.perfusionIndexPct).toBeGreaterThan(0.5);
    expect(analysis.perfusionIndexPct).toBeLessThan(0.8);
  });

  it('lists every interval in time order with its native peak time and the contract flags', () => {
    const { intervals } = analysis;
    expect(intervals.length).toBe(
      analysis.segments.flat().filter((beat) => beat.beatClass !== 'not-a-beat').length - 1,
    );
    intervals.forEach((interval, i) => {
      expect(Number.isInteger(interval.tNs)).toBe(true);
      if (i > 0) {
        expect(interval.tNs).toBeGreaterThan(intervals[i - 1]!.tNs);
        expect(interval.ibiMs).toBeCloseTo((interval.tNs - intervals[i - 1]!.tNs) / 1e6, 4);
      }
    });
    const nearestTruth = (tNs: number) =>
      Math.min(...reading.peaksS.map((peakS) => Math.abs((tNs - CLOCK_START_NS) / 1e9 - peakS)));
    expect(Math.max(...intervals.map((interval) => nearestTruth(interval.tNs)))).toBeLessThan(0.01);
    expect(intervals.every((interval) => interval.accepted)).toBe(true);
  });

  it('builds DSP-15 windows and their 8-feature vectors', () => {
    expect(analysis.enoughRhythmIntervals).toBe(true);
    expect(analysis.rhythmWindows.length).toBeGreaterThan(0);
    expect(analysis.rhythmFeatures).toHaveLength(analysis.rhythmWindows.length);
    expect(analysis.rhythmFeatures.every((vector) => vector.length === 8)).toBe(true);
    expect(analysis.normalizedRmssd).toBeGreaterThan(0);
    expect(analysis.normalizedRmssd).toBeLessThan(0.1);
  });

  it('passes the reading context through', () => {
    expect(analysis.context).toEqual(CONTEXT);
    expect(analysis.startNs).toBe(CLOCK_START_NS);
  });
});

describe('analyzeReading acquisition spans', () => {
  it('DSP-4: a 5 s uncovered stretch is a coverage span, lost, and its beats are artifacts', () => {
    const analysis = analyze(syntheticReading({ fingerOff: (tS) => tS >= 30 && tS < 35 }));
    const [span] = spansOf(analysis, 'coverage');
    expect(spansOf(analysis, 'coverage')).toHaveLength(1);
    expect(span!.startS).toBeCloseTo(30, 9);
    expect(span!.endS).toBeCloseTo(35, 9);
    expect(analysis.lostSeconds.coverage).toBeCloseTo(5, 9);
    expect(analysis.cleanSeconds).toBeCloseTo(analysis.durationS - 5, 9);
    const inside = analysis.segments.flat().filter((beat) => beat.peakS > 30.2 && beat.peakS < 34.8);
    expect(inside.every((beat) => beat.beatClass === 'artifact' || beat.beatClass === 'not-a-beat')).toBe(
      true,
    );
  });

  it('DSP-4: each failed condition alone uncovers a frame', () => {
    const { dsp4 } = DSP_CONFIG;
    expect(dsp4).toEqual({ minRedRatio: 2, minRedMean: 0.3, maxSpatialStdR: 0.1, maxClipFrac: 0.05 });
    const base = syntheticReading({ seconds: 30 });
    const edits: [string, (sample: Sample, stat: FrameStat) => void][] = [
      ['ratio', (sample) => Object.assign(sample, { g: 0.2, b: 0.15 })], // 0.62 / 0.35 < 2
      ['red mean', (sample) => Object.assign(sample, { r: 0.29, g: 0.05, b: 0.05 })],
      ['spatial std', (_, stat) => Object.assign(stat, { spatialStdR: 0.11 })],
    ];
    for (const [, edit] of edits) {
      const samples = base.samples.map((sample) => ({ ...sample }));
      const stats = base.stats.map((stat) => ({ ...stat }));
      for (let k = 600; k < 660; k++) edit(samples[k]!, stats[k]!);
      const analysis = analyzeReading({ samples, stats }, CONTEXT);
      expect(spansOf(analysis, 'coverage')).toHaveLength(1);
      expect(analysis.lostSeconds.coverage).toBeCloseTo(1, 9);
    }
  });

  it('DSP-4: clipping over 5% on a covered frame is a clipping span, counted as pressure', () => {
    const analysis = analyze(syntheticReading({ clipped: (tS) => tS >= 40 && tS < 43 }));
    expect(spansOf(analysis, 'clipping')).toHaveLength(1);
    expect(spansOf(analysis, 'coverage')).toHaveLength(0);
    expect(analysis.lostSeconds.pressure).toBeCloseTo(3, 9);
  });

  it('DSP-5: an exposure change marks the following 1 s, which is not a coaching loss', () => {
    const analysis = analyze(syntheticReading({ exposureNs: (tS) => (tS < 20 ? 8_000_000 : 6_000_000) }));
    const spans = spansOf(analysis, 'exposure');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.startS).toBeCloseTo(20, 9);
    expect(spans[0]!.endS).toBeCloseTo(21, 9);
    expect(analysis.cleanSeconds).toBeCloseTo(analysis.durationS - 1, 9);
    expect(analysis.lostSeconds).toEqual({ motion: 0, pressure: 0, coverage: 0, coldHands: 0 });
  });

  it('takes cold-hands pauses from the live session in native ns', () => {
    const analysis = analyze(syntheticReading(), {
      coldHandsSpans: [{ startNs: CLOCK_START_NS + 12e9, endNs: CLOCK_START_NS + 18e9 }],
    });
    expect(spansOf(analysis, 'coldHands')).toEqual([{ startS: 12, endS: 18, reason: 'coldHands' }]);
    expect(analysis.lostSeconds.coldHands).toBeCloseTo(6, 9);
    expect(analysis.cleanSeconds).toBeCloseTo(analysis.durationS - 6, 9);
  });

  it('takes motion spans from the caller in native ns', () => {
    const analysis = analyze(syntheticReading(), {
      motionSpans: [{ startNs: CLOCK_START_NS + 50e9, endNs: CLOCK_START_NS + 54e9 }],
    });
    expect(spansOf(analysis, 'motion')).toEqual([{ startS: 50, endS: 54, reason: 'motion' }]);
    expect(analysis.lostSeconds.motion).toBeCloseTo(4, 9);
  });

  it('rejects the 4 s window behind each SQI score under the threshold', () => {
    const windows = [10, 11, 12].map((endS) => ({
      endNs: CLOCK_START_NS + endS * 1e9,
      pClean: endS === 11 ? 0.2 : 0.9,
    }));
    const analysis = analyze(syntheticReading(), { sqi: { threshold: 0.5, windows } });
    expect(analysis.sqiAvailable).toBe(true);
    expect(spansOf(analysis, 'quality')).toEqual([{ startS: 7, endS: 11, reason: 'quality' }]);
    expect(analysis.cleanSeconds).toBeCloseTo(analysis.durationS - 4, 9);
  });

  it('ADR 0023: rejects each 4 s window of equal red frames from the capture, with or without SQI-Net', () => {
    const base = syntheticReading({ seconds: 40 });
    const samples = base.samples.map((sample) => ({ ...sample }));
    for (let k = 600; k < 1200; k++) samples[k]!.r = 0.62; // 10 s to 19.98 s flat
    for (const sqi of [null, { threshold: 0.5, windows: [] }]) {
      const analysis = analyzeReading({ samples, stats: base.stats }, { ...CONTEXT, sqi });
      const quality = spansOf(analysis, 'quality');
      expect(quality.length).toBeGreaterThan(0);
      for (const span of quality) {
        expect(span.endS - span.startS).toBeCloseTo(DSP_CONFIG.dsp3.modelWindowS, 9);
        // 64 Hz grid ends (ADR 0023), inside the flat frames.
        expect(span.endS * 64).toBe(Math.round(span.endS * 64));
        expect(span.startS).toBeGreaterThanOrEqual(10);
        expect(span.endS).toBeLessThanOrEqual(1199 / 60);
      }
      expect(analysis.sqiAvailable).toBe(sqi !== null);
    }
    expect(spansOf(analyze(base), 'quality')).toEqual([]);
  });

  it('splits at a dropped 300 ms stretch: no interval spans the gap', () => {
    const analysis = analyze(syntheticReading({ dropped: (tS) => tS > 45 && tS < 45.3 }));
    expect(analysis.segments).toHaveLength(2);
    const gapRows = analysis.intervals.filter(
      (interval) =>
        interval.tNs - interval.ibiMs * 1e6 < CLOCK_START_NS + 45.3e9 && interval.tNs > CLOCK_START_NS + 45e9,
    );
    expect(gapRows).toEqual([]);
  });

  it('marks nn only for normal → normal intervals without a long pause', () => {
    const analysis = analyze(syntheticReading({ fingerOff: (tS) => tS >= 30 && tS < 35 }));
    for (const interval of analysis.intervals) if (interval.nn) expect(interval.accepted).toBe(true);
    expect(analysis.intervals.some((interval) => !interval.accepted)).toBe(true);
  });
});

describe('analyzeReading performance', () => {
  // §9.3: final analysis of a 90 s reading < 1 s on a mid-range phone. Node on a PC is faster, so this
  // is a regression guard, not a proof of the phone budget.
  it('analyzes a 90 s, 60 fps capture in under 1 s on this machine', () => {
    const reading = syntheticReading();
    const started = performance.now();
    analyze(reading);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
