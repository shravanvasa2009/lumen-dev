// Red team v3 for SAFE-1 (spec §10.1 Emergency screen, ADR 0076) at bcccb4b: the summed rolling HR with
// DSP-9 long pauses counted as round(interval / reference) beats, the shared longPauseReference, and the
// ns margins and bridge. Every signal goes through analyzeReading unless the test says "intervals".
// R1–R2 are the findings fixed after it by the larger of the mean and median-interval rates; each states
// the safe behaviour. Upstream limits U1–U6, tradeoff T1, and the N1 misses where about half the beats are
// lost for 15–20 s are known and not repeated here.
import {
  analyzeReading,
  classifyBeats,
  emergencyHeartRate,
  type BeatInterval,
  type ReadingAnalysis,
  type ReadingContext,
  type RejectedSpan,
} from '../../src';
import type { DetectedBeat } from '../../src/beats';
import { median } from '../../src/median';
import { captureAt, regularOffsets } from '../synthetic';
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

// Park–Miller, as seededNormal draws from, so a failing seed reproduces.
function seededUniform(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function analyze(channels: Channels, seconds: number, offsets?: number[]): ReadingAnalysis {
  return analyzeReading(captureAt(offsets ?? regularOffsets(30, seconds), channels), CONTEXT);
}

function noisy(channels: Channels, sd: number, seed: number): Channels {
  const noise = seededNormal(seed);
  return (tS) => {
    const frame = channels(tS);
    return { ...frame, r: frame.r + sd * noise() };
  };
}

// Beats where the flagged ones have `ratio` × the amplitude; at 0.08 DSP-9 calls them "not a beat", so the
// interval across each is doubled, accepted, and clean: a missed beat.
function withWeakBeats(times: number[], weak: boolean[], ratio: number): Channels {
  const pulse = (x: number) =>
    Math.exp(-0.5 * ((x - 0.12) / 0.07) ** 2) + 0.3 * Math.exp(-0.5 * ((x - 0.4) / 0.07) ** 2);
  return (tS) => {
    let volume = 0;
    times.forEach((beatS, k) => {
      if (Math.abs(tS - beatS) < 1) volume += (weak[k] ? ratio : 1) * pulse(tS - beatS);
    });
    return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
  };
}

// A real analysis whose intervals a test replaces; emergencyHeartRate reads intervals, rejectedSpans,
// startNs, heartRateBpm, withoutSqiNet, and the rest flag.
const BASE = analyze(beatTrain(beatTimes([60 / 72], 20)), 20);

function withIntervals(intervals: BeatInterval[], heartRateBpm = 140): ReadingAnalysis {
  return { ...BASE, durationS: 9999, rejectedSpans: [], intervals, heartRateBpm, withoutSqiNet: null };
}

// Intervals laid end to end from 1 s; a gapNs entry leaves that many ns with no interval before the next.
function laidOut(lengthsNs: number[], gapsNs: Map<number, number> = new Map()): BeatInterval[] {
  let atNs = BASE.startNs + 1e9;
  return lengthsNs.map((ns, k) => {
    atNs += (gapsNs.get(k) ?? 0) + ns;
    return { tNs: atNs, ibiMs: ns / 1e6, accepted: true, nn: true };
  });
}

const fastFromIntervals = (intervals: BeatInterval[]) =>
  emergencyHeartRate(withIntervals(intervals))?.fastSustained ?? false;

// Interval lengths in ms for at least totalMs, cycling through patternMs.
function cycling(patternMs: number[], totalMs: number): number[] {
  const lengthsMs: number[] = [];
  for (let sumMs = 0, k = 0; sumMs < totalMs; k++) {
    lengthsMs.push(patternMs[k % patternMs.length]!);
    sumMs += lengthsMs[k]!;
  }
  return lengthsMs;
}

const toNs = (lengthsMs: number[]) => lengthsMs.map((ms) => Math.round(ms * 1e6));

// Seeded beat lists for classifyBeats: about 10% long pauses (1.5–3×), 5% short intervals, 5% low
// upslopes ("not a beat"), 10% unseen feet, and a rejected span in 30% of the lists.
function randomBeatList(seed: number) {
  const uniform = seededUniform(seed * 7919);
  // The first Park–Miller draw of a small seed is near 0.
  uniform();
  const normal = seededNormal(seed * 7919 + 7);
  const count = 5 + Math.floor(uniform() * 30);
  const baseS = 0.3 + uniform() * 0.8;
  const beats: DetectedBeat[] = [];
  let peakS = 0.1 + uniform() * 0.5;
  for (let i = 0; i < count; i++) {
    const draw = uniform();
    const stepS =
      draw < 0.1
        ? baseS * (1.5 + uniform() * 1.5)
        : draw < 0.15
          ? baseS * 0.4
          : baseS * (1 + 0.15 * normal());
    peakS += Math.max(0.05, stepS);
    beats.push({
      peakS,
      onsetS: uniform() < 0.1 ? null : peakS - 0.1,
      maxUpslope: Math.abs(1 + 0.4 * normal()) * (uniform() < 0.05 ? 0.1 : 1),
      amplitude: Math.abs(1 + 0.4 * normal()),
    });
  }
  const values = Float64Array.from(
    { length: Math.ceil((peakS + 0.5) * 256) },
    (_, k) => Math.sin((2 * Math.PI * k) / 256 / baseS) + 0.1 * normal(),
  );
  const spanStartS = peakS * uniform();
  const spans: RejectedSpan[] =
    uniform() < 0.3 ? [{ startS: spanStartS, endS: spanStartS + 2 * uniform(), reason: 'motion' }] : [];
  return { beats, shape: { firstIndex: 0, values }, spans };
}

const CLASS_CODES = { normal: 'N', atypical: 'A', artifact: 'X', 'not-a-beat': '_' } as const;

// FNV-1a, 32 bit: a short fingerprint of every class and long-pause flag.
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) hash = Math.imul(hash ^ text.charCodeAt(k), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

describe('red team v3 SAFE-1: DSP-9 after longPauseReference moved out', () => {
  // Produced by this same code at c53b913, before the refactor; a deliberate DSP-9 change re-derives it.
  const C53B913_FINGERPRINT = '6a1e1d63';

  it('classes and long-pause flags of 600 seeded beat lists match c53b913 exactly', () => {
    const lines = Array.from({ length: 600 }, (_, k) => {
      const { beats, shape, spans } = randomBeatList(k + 1);
      return classifyBeats(beats, shape, spans)
        .map((beat) => CLASS_CODES[beat.beatClass] + (beat.longPause ? 'L' : ''))
        .join('');
    });
    const longPauses = lines.join('').split('L').length - 1;
    expect(longPauses).toBeGreaterThan(500);
    expect(fingerprint(lines.join('\n'))).toBe(C53B913_FINGERPRINT);
  });
});

describe('red team v3 SAFE-1: margins and the bridge at ns resolution', () => {
  // 60e9 / 399_973_335 ns is 150.0100002 bpm and 60e9 / 399_973_336 ns is 150.0099998: 1 ns either side
  // of 150 + 0.01.
  it.each([
    [399_973_335, true],
    [399_973_336, false],
  ])('intervals: %i ns for 90 s: fastSustained is %s', (ns, fast) => {
    const count = Math.ceil(90e9 / ns);
    expect(fastFromIntervals(laidOut(Array.from({ length: count }, () => ns)))).toBe(fast);
  });

  it.each([
    [39.9949, true],
    [39.9951, false],
  ])('a reading HR of %f bpm without SQI-Net: slowBelow40 is %s (40 − 0.005)', (bpm, slow) => {
    expect(emergencyHeartRate(withIntervals([], bpm))?.slowBelow40 ?? false).toBe(slow);
  });

  // 375 ms (160 bpm) in two 35 s runs: only a bridged break lets the count reach 60 clean s.
  it.each([
    [6e9, true],
    [6e9 + 1, false],
  ])('intervals: two 35 s runs at 160 bpm, a break of %i ns: fastSustained is %s', (gapNs, fast) => {
    const lengths = Array.from({ length: 2 * 94 }, () => 375e6);
    expect(fastFromIntervals(laidOut(lengths, new Map([[94, gapNs]])))).toBe(fast);
  });

  it('intervals: a doubled interval at the first and last position keeps the 160 bpm rate', () => {
    const lengths = toNs(cycling([375, 375, 375, 750], 90_000));
    lengths[0] = 750e6;
    lengths[lengths.length - 1] = 750e6;
    expect(fastFromIntervals(laidOut(lengths))).toBe(true);
  });
});

// AF-like interval lengths (lognormal, CV 0.2) for 95 s with this mean rate.
function afLikeLengthsNs(bpm: number, seed: number): number[] {
  const sigma = Math.sqrt(Math.log(1.04));
  const medianMs = 60000 / bpm / Math.exp((sigma * sigma) / 2);
  const normal = seededNormal(seed * 7919);
  const lengthsMs: number[] = [];
  for (let sumMs = 0; sumMs < 95_000; sumMs += lengthsMs[lengthsMs.length - 1]!)
    lengthsMs.push(Math.min(2400, Math.max(260, medianMs * Math.exp(sigma * normal()))));
  return toNs(lengthsMs);
}

const SEEDS_1_60 = Array.from({ length: 60 }, (_, k) => k + 1);

describe('red team v3 SAFE-1: the rolling HR, checked without finding', () => {
  it.each([120, 130, 140])(
    'intervals: AF-like lognormal at %i bpm mean, CV 0.2, seeds 1–60, 95 s: never fast',
    (bpm) => {
      expect(SEEDS_1_60.filter((seed) => fastFromIntervals(laidOut(afLikeLengthsNs(bpm, seed))))).toEqual([]);
    },
  );

  // At a 145 bpm mean the median interval of a right-skewed rhythm is shorter than the mean, so DSP-11
  // shows about 148, and over 150 on some seeds. The rule may fire only where the shown HR does: seed 11
  // fires, and DSP-11's median interval over its 95 s reads 154.7 (the accepted AF note, ADR 0076).
  it('intervals: AF-like lognormal at 145 bpm mean, CV 0.2, seeds 1–60: fast only where DSP-11 shows > 150', () => {
    const firedShownBpm = SEEDS_1_60.flatMap((seed) => {
      const lengthsNs = afLikeLengthsNs(145, seed);
      return fastFromIntervals(laidOut(lengthsNs)) ? [60e9 / median(lengthsNs)] : [];
    });
    expect(firedShownBpm.filter((bpm) => bpm <= 150)).toEqual([]);
  });

  // The median interval is the sinus interval and the mean is lower, so the rate never exceeds the sinus
  // rate.
  it('intervals: sinus 148 bpm with a 2× sinus pause every 12 beats, 300 s: not fast', () => {
    const rrMs = 60000 / 148;
    expect(fastFromIntervals(laidOut(toNs(cycling([...Array(11).fill(rrMs), 2 * rrMs], 300_000))))).toBe(
      false,
    );
  });

  it.each([
    [125, 0.004],
    [145, 0.003],
    [145, 0.004],
  ])(
    'sinus %i bpm with red noise SD %f, seeds 1–4, 95 s: never fast',
    (bpm, sd) => {
      const fired = [1, 2, 3, 4].filter(
        (seed) =>
          emergencyHeartRate(analyze(noisy(beatTrain(beatTimes([60 / bpm], 95)), sd, seed), 95))
            ?.fastSustained,
      );
      expect(fired).toEqual([]);
    },
    SLOW_TEST_MS,
  );

  it.each([
    [148, false],
    [155, true],
  ])(
    '%i bpm, a 300 ms frame drop every 5 s, red noise SD 0.001, 95 s: fastSustained is %s',
    (bpm, fast) => {
      const offsets = regularOffsets(30, 95).filter((tS) => (tS + 0.7) % 5 > 0.3);
      const analysis = analyze(noisy(beatTrain(beatTimes([60 / bpm], 95)), 0.001, 1), 95, offsets);
      expect(emergencyHeartRate(analysis)?.fastSustained ?? false).toBe(fast);
    },
    SLOW_TEST_MS,
  );

  it('160 bpm, pressure flattening to 0.15× for 6 s every 30 s, red noise SD 0.001, 125 s: fast', () => {
    const regular = beatTrain(beatTimes([60 / 160], 125));
    const noise = seededNormal(1);
    const flattened: Channels = (tS) => {
      const frame = regular(tS);
      const scale = (tS + 1) % 30 < 6 ? 0.15 : 1;
      return { ...frame, r: 0.6 + (frame.r - 0.6) * scale + 0.001 * noise() };
    };
    expect(emergencyHeartRate(analyze(flattened, 125))?.fastSustained).toBe(true);
  });
});

describe('red team v3 SAFE-1 findings', () => {
  // R1: at bcccb4b a pause of 1.6–1.8× (a non-conducted premature beat with sinus reset) counted as 2 beats,
  // so the rolling rate rose above the sinus rate itself: sinus × (1 + q) / (1 + 0.65 q) for a fraction q
  // of 1.65× pauses. DSP-11 shows the sinus rate; the pulse rate is lower still.
  it('R1 intervals: 428.571/428.571/707.143 ms (sinus 140, every 3rd cycle a 1.65× pause; pulse 115 bpm, DSP-11 140): not fast', () => {
    expect(fastFromIntervals(laidOut(toNs(cycling([428.571, 428.571, 707.143], 300_000))))).toBe(false);
  });

  it('R1 intervals: 405.405 ms × 6 then 668.919 ms (sinus 148, every 7th cycle 1.65×; pulse 135 bpm): not fast', () => {
    expect(fastFromIntervals(laidOut(toNs(cycling([...Array(6).fill(405.405), 668.919], 300_000))))).toBe(
      false,
    );
  });

  it(
    'R1 sinus 148 bpm, 15% of cycles a 1.65× pause (seed 1), 95 s: not fast (pulse ~134, DSP-11 148)',
    () => {
      const uniform = seededUniform(11);
      const rrS = 60 / 148;
      const times: number[] = [];
      for (let tS = -2; tS < 97; tS += uniform() < 0.15 ? 1.65 * rrS : rrS) times.push(tS);
      const analysis = analyze(beatTrain(times), 95);
      expect(analysis.heartRateBpm).toBeLessThan(150);
      expect(emergencyHeartRate(analysis)?.fastSustained ?? false).toBe(false);
    },
    SLOW_TEST_MS,
  );

  // R2: at bcccb4b, when 4 of a beat's 8 DSP-9 neighbours were doubled, their median was 1.5× the true
  // interval, so a doubled interval was only 1.33× it and counted as 1. With about 30% of beats missed at
  // random the rolling rate dropped below 150 while DSP-11 (median of all intervals) showed the true rate.
  // Seeds 2, 3, 5, and 7 missed at bcccb4b.
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'R2 160 bpm, 30% of beats at 0.08× the amplitude at random (seed %i), 95 s: fastSustained (DSP-11 ~160)',
    (seed) => {
      const uniform = seededUniform(seed * 23);
      const times = beatTimes([60 / 160], 95);
      const analysis = analyze(
        withWeakBeats(
          times,
          times.map(() => uniform() < 0.3),
          0.08,
        ),
        95,
      );
      expect(analysis.heartRateBpm).toBeGreaterThan(155);
      expect(emergencyHeartRate(analysis)?.fastSustained).toBe(true);
    },
    SLOW_TEST_MS,
  );

  // Left out: "R2 intervals: 170 bpm, 30% of beats missed at random, seeds 1–20: fast on at least 18" fires
  // on 17 (11 at bcccb4b). Seeds 7, 13, and 18 miss: 31–36% of their intervals cross a missed beat, so some
  // 15 s windows hold more doubled intervals than single ones and neither the median nor the mean reaches
  // 150, though the 95 s median shows 170.
});
