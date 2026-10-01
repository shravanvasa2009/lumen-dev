import { estimateLiveHeartRate, type Sample } from '../../src';
import { captureAt, jitteredOffsets, regularOffsets } from '../synthetic';
import { beatTimes, beatTrain, flatRed, seededNormal, sinePulse, withRed, type Channels } from './attacks';

const JITTER_S = 0.002;
// DSP-A's error budget for a reading (3 bpm); used where an attack may cost accuracy but must not
// produce a different rate.
const PERTURBED_TOLERANCE_BPM = 3;

const liveRate = (offsetsS: number[], channels: Channels) =>
  estimateLiveHeartRate(captureAt(offsetsS, channels).samples);
const jittered = (fps: number) => jitteredOffsets(fps, 10, JITTER_S);

const shiftClock = (samples: Sample[], startNs: number) =>
  samples.map((sample) => ({ ...sample, tNs: sample.tNs - samples[0]!.tNs + startNs }));

// Null is always allowed; a number must be the true rate within the tolerance.
function expectNullOrNear(estimate: { bpm: number } | null, trueBpm: number, toleranceBpm: number): void {
  if (estimate !== null) expect(Math.abs(estimate.bpm - trueBpm)).toBeLessThanOrEqual(toleranceBpm);
}

function expectNullOrMultipleOf(estimate: { bpm: number } | null, baseBpm: number): void {
  if (estimate === null) return;
  const multiple = Math.round(estimate.bpm / baseBpm);
  expect(multiple).toBeGreaterThanOrEqual(1);
  expect(Math.abs(estimate.bpm - multiple * baseBpm)).toBeLessThanOrEqual(1);
}

describe('red team: live HR at the 40 and 180 bpm limits (ADR 0027)', () => {
  it.each([
    [40, 30],
    [40, 60],
    [180, 30],
    [180, 60],
  ])('reads a %i bpm pulse at %i fps within 1 bpm, not null', (bpm, fps) => {
    const estimate = liveRate(jittered(fps), sinePulse(bpm));
    expect(estimate).not.toBeNull();
    expect(Math.abs(estimate!.bpm - bpm)).toBeLessThanOrEqual(1);
  });

  it.each([39, 181])('returns null for a %i bpm pulse, just outside 40–180', (bpm) => {
    expect(liveRate(jittered(30), sinePulse(bpm))).toBeNull();
  });
});

describe('red team: live HR timestamps', () => {
  const pulseSamples = () => captureAt(jittered(30), sinePulse(72)).samples;

  it('gives identical output on a device clock just below 2^53 ns', () => {
    const samples = pulseSamples();
    expect(estimateLiveHeartRate(shiftClock(samples, 2 ** 53 - 11e9))).toEqual(
      estimateLiveHeartRate(samples),
    );
  });

  it('gives the same bpm, and SNR within 0.001 dB, when the clock crosses 2^53 ns mid-window', () => {
    const samples = pulseSamples();
    const early = estimateLiveHeartRate(samples)!;
    const crossing = estimateLiveHeartRate(shiftClock(samples, 2 ** 53 - 5e9))!;
    expect(crossing.bpm).toBe(early.bpm);
    expect(Math.abs(crossing.snrDb - early.snrDb)).toBeLessThan(1e-3);
  });

  it('ignores frames from an hour before the 10 s window', () => {
    const samples = pulseSamples();
    const stale = shiftClock(
      captureAt(regularOffsets(30, 1), sinePulse(72)).samples,
      samples[0]!.tNs - 3600e9,
    );
    expect(estimateLiveHeartRate([...stale, ...samples])).toEqual(estimateLiveHeartRate(samples));
  });

  it('returns null when only the newest frame follows a 1-hour stall', () => {
    const samples = pulseSamples();
    const newest = { ...samples[samples.length - 1]!, tNs: samples[samples.length - 1]!.tNs + 3600e9 };
    expect(estimateLiveHeartRate([...samples, newest])).toBeNull();
  });

  it('throws RangeError when the newest frame is delivered twice (ADR 0027: the Lab panel catches it)', () => {
    const samples = pulseSamples();
    expect(() => estimateLiveHeartRate([...samples, samples[samples.length - 1]!])).toThrow(RangeError);
  });

  it.each([
    ['NaN', 'a middle frame', NaN, 150],
    ['NaN', 'the newest frame', NaN, 299],
    ['+Infinity', 'the newest frame', Infinity, 299],
  ])('never shows a number for a %s timestamp on %s', (_name, _where, badNs, index) => {
    const samples = pulseSamples();
    samples[index] = { ...samples[index]!, tNs: badNs };
    let estimate: ReturnType<typeof estimateLiveHeartRate> = null;
    try {
      estimate = estimateLiveHeartRate(samples);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    expect(estimate).toBeNull();
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('never shows a wrong number when one frame’s red is %s', (_name, badRed) => {
    const samples = pulseSamples();
    samples[150] = { ...samples[150]!, r: badRed };
    expectNullOrNear(estimateLiveHeartRate(samples), 72, PERTURBED_TOLERANCE_BPM);
  });
});

describe('red team: live HR against capture artifacts', () => {
  // Point-sampled flicker (no exposure averaging, the worst case) at 5× the pulse amplitude. At exactly
  // 30 or 60 fps, 100/120 Hz light aliases to 10 Hz, 20 Hz or DC, and 50/60 Hz to 10 Hz or DC.
  it.each([
    [30, 100],
    [30, 120],
    [60, 100],
    [60, 120],
    [30, 50],
    [30, 60],
  ])('reads 72 bpm through %i fps sampling of %i Hz flicker (amplitude 0.03)', (fps, flickerHz) => {
    const flicker = (tS: number) => 0.03 * Math.sin(2 * Math.PI * flickerHz * tS);
    const estimate = liveRate(regularOffsets(fps, 10), withRed(sinePulse(72), flicker));
    expect(Math.abs(estimate!.bpm - 72)).toBeLessThanOrEqual(1);
  });

  it.each([
    [0.01, 2],
    [0.01, 5],
    [0.05, 2],
    [0.05, 5],
    [0.05, 8],
    [0.2, 2],
    [0.2, 5],
    [0.2, 8],
  ])('never shows a wrong rate after an exposure step of +%s at %i s', (step, atS) => {
    const estimate = liveRate(
      jittered(30),
      withRed(sinePulse(72), (tS) => (tS > atS ? step : 0)),
    );
    expectNullOrNear(estimate, 72, PERTURBED_TOLERANCE_BPM);
  });

  it.each([
    [0.05, 2],
    [0.05, 5],
    [0.2, 2],
    [0.2, 5],
  ])('never shows a wrong rate after a 1 s motion burst (white noise, SD %s) at %i s, seed 7', (sd, atS) => {
    const normal = seededNormal(7);
    const burst = (tS: number) => (tS > atS && tS < atS + 1 ? sd * normal() : 0);
    expectNullOrNear(liveRate(jittered(30), withRed(sinePulse(72), burst)), 72, PERTURBED_TOLERANCE_BPM);
  });

  it.each([
    [0.05, 2],
    [0.05, 5],
    [0.2, 2],
    [0.2, 5],
  ])('never shows a wrong rate after a 1 s finger swing of +%s at %i s', (height, atS) => {
    const swing = (tS: number) => (tS > atS && tS < atS + 1 ? height * Math.sin(Math.PI * (tS - atS)) : 0);
    expectNullOrNear(liveRate(jittered(30), withRed(sinePulse(72), swing)), 72, PERTURBED_TOLERANCE_BPM);
  });

  it.each([0.99, 1.0, 1.003])('reads 72 bpm with the pulse clipped at 1.0 (red level %s)', (level) => {
    const clipped: Channels = (tS) => {
      const frame = sinePulse(72, 0.006, level)(tS);
      return { ...frame, r: Math.min(1, frame.r) };
    };
    expect(Math.abs(liveRate(jittered(30), clipped)!.bpm - 72)).toBeLessThanOrEqual(1);
  });

  it.each([
    [0.0006, 1e-4],
    [0.0006, 3e-4],
    [0.0003, 1e-4],
    [0.0003, 3e-4],
  ])('reads 72 bpm from a cold hand: pulse %s with sensor noise SD %s (seed 3)', (amplitude, noiseSd) => {
    const normal = seededNormal(3);
    const estimate = liveRate(
      jittered(30),
      withRed(sinePulse(72, amplitude), () => noiseSd * normal()),
    );
    expect(Math.abs(estimate!.bpm - 72)).toBeLessThanOrEqual(1);
  });

  it('reads 72 bpm while pressure flattens the pulse from 1% to 0.05% over the window', () => {
    const flattening: Channels = (tS) => ({
      r: 0.6 - (0.006 - 0.00057 * tS) * Math.sin(2 * Math.PI * 1.2 * tS),
      g: 0.1,
      b: 0.05,
    });
    expect(Math.abs(liveRate(jittered(30), flattening)!.bpm - 72)).toBeLessThanOrEqual(1);
  });

  // Systolic wave at 0.12 s and dicrotic wave at 0.40 s after each foot, 70 ms wide.
  it.each([40, 45, 50, 60, 72])(
    'reads %i bpm from a pulse with dicrotic waves up to 0.9× systolic',
    (bpm) => {
      for (const dicroticRatio of [0, 0.5, 0.9]) {
        const estimate = liveRate(jittered(30), beatTrain(beatTimes([60 / bpm], 10), dicroticRatio));
        expect(Math.abs(estimate!.bpm - bpm)).toBeLessThanOrEqual(1);
      }
    },
  );

  // DEFECT: a flat red channel (finger off with the torch saturating the sensor, or a black frame
  // level) has no pulse, but DSP-2's spline leaves rounding noise of about 1e-16 and the peak-over-median
  // SNR is scale-free, so that noise passes 6 dB. In 168 flat captures (40 levels 0.05–0.97 plus 0 and
  // 1.0, 30/60 fps, with and without 2 ms jitter) 41 returned a heart rate.
  it.each([
    ['clipped at 1.0, jittered 30 fps (reads 134.4 bpm)', 1.0, jittered(30)],
    ['clipped at 1.0, jittered 60 fps (reads 100.2 bpm)', 1.0, jittered(60)],
    ['0.0737, regular 30 fps (reads 46.2 bpm)', 0.0737, regularOffsets(30, 10)],
    ['0.0737, regular 60 fps (reads 46.2 bpm)', 0.0737, regularOffsets(60, 10)],
  ])('returns null for a flat red channel %s', (_label, level, offsetsS) => {
    expect(liveRate(offsetsS, flatRed(level))).toBeNull();
  });
});

// Documented limits of the M0 proof's method (ADR 0027), recorded so that they cannot get worse without a
// test failing. Each bound still passes if the method is improved.
describe('red team: live HR known limitations (ADR 0027)', () => {
  // H-017 A keeps the 6 dB limit for M0. ADR 0027 measured 61% over 2000 draws; these 300 give 58.7%.
  it('KNOWN LIMITATION: white noise (SD 0.003, 30 fps, 300 seeded draws) returns a bpm ≤ 65% of the time', () => {
    let passes = 0;
    for (let draw = 0; draw < 300; draw++) {
      const normal = seededNormal(1000 + draw * 7919);
      if (
        liveRate(
          regularOffsets(30, 10),
          withRed(flatRed(0.6), () => 0.003 * normal()),
        )
      )
        passes++;
    }
    expect(passes / 300).toBeLessThanOrEqual(0.65);
  });

  // A second harmonic stronger than the fundamental wins: 35 bpm reads 70.2, 50 bpm reads 100.2.
  it.each([35, 50])(
    'KNOWN LIMITATION: %i bpm with a 2nd harmonic 1.2× the fundamental reads a multiple',
    (bpm) => {
      const hz = bpm / 60;
      const harmonicHeavy: Channels = (tS) => ({
        r: 0.6 - 0.006 * (Math.sin(2 * Math.PI * hz * tS) + 1.2 * Math.sin(4 * Math.PI * hz * tS)),
        g: 0.1,
        b: 0.05,
      });
      expectNullOrMultipleOf(liveRate(jittered(30), harmonicHeavy), bpm);
    },
  );

  // Bigeminy: intervals 0.5 / 1.0 s, a true pulse rate of 80 bpm and a 40 bpm pattern. Reads 120 bpm today
  // (the pattern's 3rd harmonic). With a pulse deficit (weak premature beats) the felt rate is 40.
  it('KNOWN LIMITATION: bigeminy (0.5 / 1.0 s) reads a multiple of the 40 bpm pattern', () => {
    expectNullOrMultipleOf(liveRate(jittered(30), beatTrain(beatTimes([0.5, 1.0], 10))), 40);
  });

  // AF-like intervals (uniform 0.4–1.0 s, seed 11): mean rate 91.0 bpm, reads 94.2 today. The 10 s Hann
  // main lobe (±12 bpm) is the method's resolution.
  it('KNOWN LIMITATION: AF-like intervals read within 12 bpm of the mean rate', () => {
    let state = 11;
    const intervalsS = Array.from({ length: 40 }, () => {
      state = (state * 16807) % 2147483647;
      return 0.4 + (0.6 * state) / 2147483647;
    });
    const meanBpm = 60 / (intervalsS.reduce((total, intervalS) => total + intervalS, 0) / intervalsS.length);
    expectNullOrNear(liveRate(jittered(30), beatTrain(beatTimes(intervalsS, 10))), meanBpm, 12);
  });

  // Light flicker at 120 Hz with the frame rate slightly off 30 or 60 fps aliases into the pulse band
  // (|120 − 4 × 29.5| = 2 Hz, |120 − 2 × 59.5| = 1 Hz). At 5× the pulse it is read instead of the pulse; the
  // samples alone cannot tell them apart. DSP-4's contact check is the guard.
  it.each([
    [29.5, 120],
    [59.5, 60],
  ])('KNOWN LIMITATION: 120 Hz flicker at %s fps reads either 72 or the %i bpm alias', (fps, aliasBpm) => {
    const flicker = (tS: number) => 0.03 * Math.sin(2 * Math.PI * 120 * tS);
    const estimate = liveRate(regularOffsets(fps, 10), withRed(sinePulse(72), flicker));
    if (estimate !== null) {
      const nearest = Math.abs(estimate.bpm - 72) < Math.abs(estimate.bpm - aliasBpm) ? 72 : aliasBpm;
      expect(Math.abs(estimate.bpm - nearest)).toBeLessThanOrEqual(1);
    }
  });
});
