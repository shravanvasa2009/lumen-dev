import {
  butterBandpass,
  butterLowpass,
  CausalFilter,
  DSP_CONFIG,
  filterZeroPhase,
  type SosSection,
} from '../src';
import {
  DC_LOWPASS_64HZ_SOS,
  FILTFILT_DC_LOWPASS_64HZ,
  FILTFILT_HR_BAND_64HZ,
  HR_BAND_64HZ_SOS,
  REFERENCE_INPUT,
} from './scipy-reference';

const { order, hrBandHz, morphologyBandHz } = DSP_CONFIG.dsp6;
const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;

// |H(e^{jω})| of a cascade of biquads, evaluated directly from the coefficients.
function gainAt(sos: SosSection[], frequencyHz: number, rateHz: number): number {
  const omega = (2 * Math.PI * frequencyHz) / rateHz;
  let gain = 1;
  for (const [b0, b1, b2, a0, a1, a2] of sos) {
    const numRe = b0 + b1 * Math.cos(omega) + b2 * Math.cos(2 * omega);
    const numIm = -b1 * Math.sin(omega) - b2 * Math.sin(2 * omega);
    const denRe = a0 + a1 * Math.cos(omega) + a2 * Math.cos(2 * omega);
    const denIm = -a1 * Math.sin(omega) - a2 * Math.sin(2 * omega);
    gain *= Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
  }
  return gain;
}

// Bilinear-transform centre of a band-pass: tan(π f0 / fs) = √(tan(π f1 / fs) · tan(π f2 / fs)).
function digitalCentreHz([lowHz, highHz]: number[], rateHz: number): number {
  const tanProduct = Math.tan((Math.PI * lowHz!) / rateHz) * Math.tan((Math.PI * highHz!) / rateHz);
  return (rateHz / Math.PI) * Math.atan(Math.sqrt(tanProduct));
}

function impulse(length: number): Float64Array {
  const unit = new Float64Array(length);
  unit[0] = 1;
  return unit;
}

function polyMul(left: number[], right: number[]): number[] {
  const product = new Array<number>(left.length + right.length - 1).fill(0);
  left.forEach((l, i) => right.forEach((r, j) => (product[i + j]! += l * r)));
  return product;
}

function polyPow(base: number[], power: number): number[] {
  let product = [1];
  for (let i = 0; i < power; i++) product = polyMul(product, base);
  return product;
}

// Independent reference for an order-2 Butterworth band-pass: the analog transfer function
// H(s) = bw²s² / (s⁴ + √2·bw·s³ + (2wo² + bw²)s² + √2·bw·wo²·s + wo⁴) (low-pass prototype
// 1/(s² + √2s + 1) with s → (s² + wo²)/(bw·s)), mapped by s = c(z − 1)/(z + 1) with c = 4 and
// prewarped edges w = 4·tan(π f / fs): scipy designs at a normalized fs of 2, so 2·fs = 4.
// Uses no poles, zeros, or section pairing, so it checks the SOS design end to end.
function referenceBandpassTf(lowHz: number, highHz: number, rateHz: number) {
  const c = 4;
  const wLow = c * Math.tan((Math.PI * lowHz) / rateHz);
  const wHigh = c * Math.tan((Math.PI * highHz) / rateHz);
  const bw = wHigh - wLow;
  const wo2 = wLow * wHigh;
  const analogDen = [1, Math.SQRT2 * bw, 2 * wo2 + bw * bw, Math.SQRT2 * bw * wo2, wo2 * wo2];
  const analogNum = [0, 0, bw * bw, 0, 0];
  const toDigital = (analog: number[]) =>
    analog.reduce(
      (sum, coefficient, j) => {
        const term = polyMul(polyPow([1, -1], 4 - j), polyPow([1, 1], j)).map(
          (value) => value * coefficient * c ** (4 - j),
        );
        return sum.map((value, i) => value + term[i]!);
      },
      [0, 0, 0, 0, 0],
    );
  const den = toDigital(analogDen);
  const num = toDigital(analogNum);
  return { b: num.map((value) => value / den[0]!), a: den.map((value) => value / den[0]!) };
}

function directFormImpulse({ b, a }: { b: number[]; a: number[] }, length: number): Float64Array {
  const response = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    let acc = n < b.length ? b[n]! : 0;
    for (let i = 1; i < a.length && i <= n; i++) acc -= a[i]! * response[n - i]!;
    response[n] = acc;
  }
  return response;
}

const DESIGNS = [
  { name: 'HR band at 64 Hz', band: hrBandHz, rateHz: modelRateHz },
  { name: 'morphology band at 64 Hz', band: morphologyBandHz, rateHz: modelRateHz },
  { name: 'morphology band at 256 Hz', band: morphologyBandHz, rateHz: shapeRateHz },
];

describe('DSP-6 Butterworth design', () => {
  it('matches the closed-form order-2 low-pass at fs/4 (K = tan(π/4) = 1)', () => {
    // Bilinear biquad with K = 1: b0 = K²/(1 + √2K + K²) = 1/(2 + √2), a1 = 0, a2 = (2 − √2)/(2 + √2).
    const b0 = 1 / (2 + Math.SQRT2);
    const expected = [b0, 2 * b0, b0, 1, 0, 3 - 2 * Math.SQRT2];
    const [section, ...rest] = butterLowpass(2, 16, 64);
    expect(rest).toHaveLength(0);
    section!.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 14));
  });

  it('has the same impulse response as the analytic order-2 band-pass transfer function', () => {
    const reference = directFormImpulse(referenceBandpassTf(0.6, 3.5, 64), 512);
    const fromSos = new CausalFilter(butterBandpass(2, 0.6, 3.5, 64), 0).filter(impulse(512));
    const peak = Math.max(...reference.map(Math.abs));
    reference.forEach((value, n) => expect(Math.abs(fromSos[n]! - value)).toBeLessThan(1e-12 * peak));
  });

  it('pairs sections the way scipy zpk2sos "nearest" does for the HR band', () => {
    // All poles have Re > 0, so the two poles nearest the unit circle (the last sections) take the four
    // zeros at z = +1, the other two take the zeros at z = −1, and the gain goes into section 0.
    const sos = butterBandpass(order, hrBandHz[0]!, hrBandHz[1]!, modelRateHz);
    expect(sos).toHaveLength(order);
    const [first, second, third, fourth] = sos.map((section) => section.slice(0, 3));
    expect(first![1]! / first![0]!).toBeCloseTo(2, 12);
    expect(first![2]! / first![0]!).toBeCloseTo(1, 12);
    expect(second).toEqual([1, 2, 1]);
    expect(third).toEqual([1, -2, 1]);
    expect(fourth).toEqual([1, -2, 1]);
    const radii = sos.map(([, , , , , a2]) => Math.sqrt(a2));
    expect(radii).toEqual([...radii].sort((x, y) => x - y));
  });

  it.each(DESIGNS)(
    '$name: unit gain at the centre, −3 dB at both edges, zero at DC and Nyquist',
    ({ band, rateHz }) => {
      const sos = butterBandpass(order, band[0]!, band[1]!, rateHz);
      expect(gainAt(sos, digitalCentreHz(band, rateHz), rateHz)).toBeCloseTo(1, 9);
      expect(gainAt(sos, band[0]!, rateHz)).toBeCloseTo(Math.SQRT1_2, 9);
      expect(gainAt(sos, band[1]!, rateHz)).toBeCloseTo(Math.SQRT1_2, 9);
      expect(gainAt(sos, 0, rateHz)).toBeLessThan(1e-12);
      expect(gainAt(sos, rateHz / 2, rateHz)).toBeLessThan(1e-12);
    },
  );

  it.each([modelRateHz, shapeRateHz])(
    'DSP-3 DC low-pass at %d Hz: unit gain at DC, −3 dB at the cutoff',
    (rateHz) => {
      const { dcCutoffHz, dcOrder } = DSP_CONFIG.dsp3;
      const sos = butterLowpass(dcOrder, dcCutoffHz, rateHz);
      expect(gainAt(sos, 0, rateHz)).toBeCloseTo(1, 12);
      expect(gainAt(sos, dcCutoffHz, rateHz)).toBeCloseTo(Math.SQRT1_2, 9);
    },
  );

  it('keeps every section of every configured filter inside the biquad stability triangle', () => {
    const { dcCutoffHz, dcOrder } = DSP_CONFIG.dsp3;
    const all = [
      ...DESIGNS.map(({ band, rateHz }) => butterBandpass(order, band[0]!, band[1]!, rateHz)),
      ...[modelRateHz, shapeRateHz].map((rateHz) => butterLowpass(dcOrder, dcCutoffHz, rateHz)),
    ];
    // Both poles of 1 + a1 z⁻¹ + a2 z⁻² lie inside the unit circle iff |a2| < 1 and |a1| < 1 + a2.
    for (const [, , , , a1, a2] of all.flat()) {
      expect(Math.abs(a2)).toBeLessThan(1);
      expect(Math.abs(a1)).toBeLessThan(1 + a2);
    }
  });

  it('rejects odd orders, which this design does not pair', () => {
    expect(() => butterBandpass(3, 0.6, 3.5, 64)).toThrow(RangeError);
    expect(() => butterLowpass(1, 0.3, 64)).toThrow(RangeError);
  });

  it('rejects edges outside (0, Nyquist)', () => {
    expect(() => butterBandpass(4, 0.6, 40, 64)).toThrow(RangeError);
    expect(() => butterLowpass(2, 0, 64)).toThrow(RangeError);
  });
});

describe('DSP-6 zero-phase filtering (scipy sosfiltfilt)', () => {
  const sos = butterBandpass(order, hrBandHz[0]!, hrBandHz[1]!, modelRateHz);
  const pulseHz = 1.2;
  const seconds = 60;
  const tS = Array.from({ length: seconds * modelRateHz }, (_, n) => n / modelRateHz);
  const pulse = Float64Array.from(tS, (t) => Math.sin(2 * Math.PI * pulseHz * t));

  // Forward-backward filtering gives |H|² with no phase shift. The slowest pole decays by more than
  // e^-15 over 20 s, so the middle 20 s is steady state to well under 1e-6.
  const middle = (n: number) => tS[n]! >= 20 && tS[n]! < 40;

  it('passes an in-band sine with gain |H|² and no phase shift', () => {
    const gain2 = gainAt(sos, pulseHz, modelRateHz) ** 2;
    const filtered = filterZeroPhase(sos, pulse);
    pulse.forEach((value, n) => {
      if (middle(n)) expect(Math.abs(filtered[n]! - gain2 * value)).toBeLessThan(1e-6);
    });
  });

  it('a causal pass of the same sine is phase-shifted (the check above is sensitive)', () => {
    const causal = new CausalFilter(sos, pulse[0]!).filter(pulse);
    const worst = Math.max(
      ...Array.from(pulse, (value, n) => (middle(n) ? Math.abs(causal[n]! - value) : 0)),
    );
    expect(worst).toBeGreaterThan(0.1);
  });

  it('rejects DC: a constant gives zero, and an offset does not change the output', () => {
    const constant = new Float64Array(tS.length).fill(0.7);
    expect(Math.max(...filterZeroPhase(sos, constant).map(Math.abs))).toBeLessThan(1e-10);
    const shifted = filterZeroPhase(
      sos,
      pulse.map((value) => value + 0.7),
    );
    const unshifted = filterZeroPhase(sos, pulse);
    shifted.forEach((value, n) => expect(Math.abs(value - unshifted[n]!)).toBeLessThan(1e-10));
  });

  it('needs more samples than scipy padlen = 3·(2·sections + 1)', () => {
    // 4 sections with nonzero b2 and a2: padlen 27. 1 low-pass section: padlen 9.
    expect(() => filterZeroPhase(sos, pulse.subarray(0, 27))).toThrow(RangeError);
    expect(filterZeroPhase(sos, pulse.subarray(0, 28))).toHaveLength(28);
    const lowpass = butterLowpass(2, 0.3, 64);
    expect(() => filterZeroPhase(lowpass, pulse.subarray(0, 9))).toThrow(RangeError);
    expect(filterZeroPhase(lowpass, pulse.subarray(0, 10))).toHaveLength(10);
  });
});

describe('DSP-6 causal filtering for the live display', () => {
  const lowpass = butterLowpass(2, 0.3, 64);

  it('starts in steady state for the first sample (no start-up transient)', () => {
    const constant = new Float64Array(64).fill(0.62);
    new CausalFilter(lowpass, 0.62).filter(constant).forEach((value) => expect(value).toBeCloseTo(0.62, 12));
  });

  it('gives the same output whether fed at once or in 100 ms batches', () => {
    const input = Float64Array.from({ length: 640 }, (_, n) => Math.sin(n / 7) + 0.5);
    const whole = new CausalFilter(lowpass, input[0]!).filter(input);
    const batched = new CausalFilter(lowpass, input[0]!);
    const pieces: number[] = [];
    for (let start = 0; start < input.length; start += 6) {
      pieces.push(...batched.filter(input.subarray(start, start + 6)));
    }
    pieces.forEach((value, n) => expect(value).toBe(whole[n]));
  });
});

// Observed agreement is 2.2e-16 (coefficients) and 1.6e-14 (filtered samples); the bounds leave room for
// libm differences between machines and stay far inside the 1e-6 parity budget (§10.2).
describe('DSP-6 agreement with scipy 1.17.1 output', () => {
  const expectClose = (actual: ArrayLike<number>, expected: number[], tolerance: number) => {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((value, i) => expect(Math.abs(actual[i]! - value)).toBeLessThan(tolerance));
  };

  it('designs the same HR band-pass sections as butter(4, [0.6, 3.5], "band", fs=64)', () => {
    const sos = butterBandpass(4, 0.6, 3.5, 64);
    expectClose(sos.flat(), HR_BAND_64HZ_SOS.flat(), 1e-15);
  });

  it('designs the same DC low-pass section as butter(2, 0.3, fs=64)', () => {
    expectClose(butterLowpass(2, 0.3, 64).flat(), DC_LOWPASS_64HZ_SOS.flat(), 1e-15);
  });

  it('filters like sosfiltfilt, including its odd padding and initial conditions', () => {
    expectClose(
      filterZeroPhase(butterBandpass(4, 0.6, 3.5, 64), REFERENCE_INPUT),
      FILTFILT_HR_BAND_64HZ,
      1e-12,
    );
    expectClose(filterZeroPhase(butterLowpass(2, 0.3, 64), REFERENCE_INPUT), FILTFILT_DC_LOWPASS_64HZ, 1e-12);
  });
});
