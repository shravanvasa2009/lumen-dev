// Mirrors scipy.signal (1.17): butter(N, Wn, btype, output='sos', fs) via buttap, lp2bp_zpk / lp2lp_zpk,
// bilinear_zpk and zpk2sos(pairing='nearest'); sosfilt; sosfilt_zi; sosfiltfilt(padtype='odd').
// Source: https://github.com/scipy/scipy/blob/v1.17.1/scipy/signal/_filter_design.py and _signaltools.py

// [b0, b1, b2, a0, a1, a2] with a0 = 1, as in scipy's sos arrays.
export type SosSection = [number, number, number, number, number, number];

interface Complex {
  re: number;
  im: number;
}
const complex = (re: number, im = 0): Complex => ({ re, im });
const add = (x: Complex, y: Complex) => complex(x.re + y.re, x.im + y.im);
const sub = (x: Complex, y: Complex) => complex(x.re - y.re, x.im - y.im);
const mul = (x: Complex, y: Complex) => complex(x.re * y.re - x.im * y.im, x.re * y.im + x.im * y.re);
const scale = (x: Complex, factor: number) => complex(x.re * factor, x.im * factor);
function div(x: Complex, y: Complex): Complex {
  const denominator = y.re * y.re + y.im * y.im;
  return complex((x.re * y.re + x.im * y.im) / denominator, (x.im * y.re - x.re * y.im) / denominator);
}
// Principal square root; conjugate-symmetric, so conjugate pole pairs stay exact conjugates.
function sqrt(x: Complex): Complex {
  const modulus = Math.hypot(x.re, x.im);
  const re = Math.sqrt((modulus + x.re) / 2);
  const im = Math.sqrt((modulus - x.re) / 2);
  return complex(re, x.im < 0 ? -im : im);
}
const abs = (x: Complex) => Math.hypot(x.re, x.im);

// scipy designs digital filters at a normalized fs of 2, so the bilinear constant 2·fs is 4.
const BILINEAR_C = 4;

function prewarp(frequencyHz: number, rateHz: number): number {
  if (!(frequencyHz > 0 && frequencyHz < rateHz / 2))
    throw new RangeError(`edge ${frequencyHz} Hz must lie in (0, ${rateHz / 2}) Hz`);
  return BILINEAR_C * Math.tan((Math.PI * frequencyHz) / rateHz);
}

// buttap: poles −exp(jπm / 2N) for m = −N+1, −N+3, …, N−1; no zeros; gain 1.
function butterworthPrototypePoles(order: number): Complex[] {
  if (!Number.isInteger(order) || order < 2 || order % 2 !== 0)
    throw new RangeError(`order must be an even integer ≥ 2 (got ${order}); odd orders add a real pole`);
  const poles: Complex[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const angle = (Math.PI * m) / (2 * order);
    poles.push(complex(-Math.cos(angle), -Math.sin(angle)));
  }
  return poles;
}

interface Zpk {
  zeros: Complex[];
  poles: Complex[];
  gain: number;
}

// bilinear_zpk with fs = 2; zeros at infinity map to z = −1.
function bilinear({ zeros, poles, gain }: Zpk): Zpk {
  const c = complex(BILINEAR_C);
  const mapped = (s: Complex) => div(add(c, s), sub(c, s));
  const numerator = zeros.reduce((product, z) => mul(product, sub(c, z)), complex(1));
  const denominator = poles.reduce((product, p) => mul(product, sub(c, p)), complex(1));
  return {
    zeros: [...zeros.map(mapped), ...poles.slice(zeros.length).map(() => complex(-1))],
    poles: poles.map(mapped),
    gain: gain * div(numerator, denominator).re,
  };
}

// zpk2sos(pairing='nearest') for the case these designs produce: complex-conjugate poles only and real
// zeros. Sections are filled from the last: each takes the remaining pole nearest the unit circle and the
// two zeros nearest that pole; the overall gain goes into section 0.
function zpkToSos({ zeros, poles, gain }: Zpk): SosSection[] {
  // _cplxreal: one pole per conjugate pair (positive imaginary part), sorted by real then |imag|.
  const remainingPoles = poles
    .filter((p) => p.im > 0)
    .sort((x, y) => x.re - y.re || Math.abs(x.im) - Math.abs(y.im));
  if (remainingPoles.length * 2 !== poles.length)
    throw new RangeError('expected complex-conjugate poles only');
  const remainingZeros = zeros.map((z) => z.re).sort((x, y) => x - y);

  // argmin / stable argsort semantics: the first index wins a tie.
  const takeNearestZero = (pole: Complex) => {
    let best = 0;
    remainingZeros.forEach((z, i) => {
      if (abs(sub(complex(z), pole)) < abs(sub(complex(remainingZeros[best]!), pole))) best = i;
    });
    return remainingZeros.splice(best, 1)[0]!;
  };

  const sections = new Array<SosSection>(remainingPoles.length);
  for (let si = sections.length - 1; si >= 0; si--) {
    let worst = 0;
    remainingPoles.forEach((p, i) => {
      if (Math.abs(1 - abs(p)) < Math.abs(1 - abs(remainingPoles[worst]!))) worst = i;
    });
    const pole = remainingPoles.splice(worst, 1)[0]!;
    const z1 = takeNearestZero(pole);
    const z2 = takeNearestZero(pole);
    sections[si] = [1, -(z1 + z2), z1 * z2, 1, -2 * pole.re, pole.re * pole.re + pole.im * pole.im];
  }
  const first = sections[0]!;
  for (let i = 0; i < 3; i++) first[i] = first[i]! * gain;
  return sections;
}

/** DSP-6: Butterworth band-pass as second-order sections, same as scipy butter(order, band, 'band'). */
export function butterBandpass(order: number, lowHz: number, highHz: number, rateHz: number): SosSection[] {
  const prototype = butterworthPrototypePoles(order);
  const wLow = prewarp(lowHz, rateHz);
  const wHigh = prewarp(highHz, rateHz);
  if (!(wLow < wHigh)) throw new RangeError(`band edges must increase: ${lowHz}, ${highHz} Hz`);
  const bandwidth = wHigh - wLow;
  const centre2 = complex(wLow * wHigh);
  // lp2bp_zpk: p·bw/2 ± √((p·bw/2)² − wo²), all "+" roots first; N zeros at s = 0; gain bw^N.
  const halfScaled = prototype.map((p) => scale(p, bandwidth / 2));
  const roots = halfScaled.map((p) => sqrt(sub(mul(p, p), centre2)));
  const analog: Zpk = {
    zeros: prototype.map(() => complex(0)),
    poles: [...halfScaled.map((p, i) => add(p, roots[i]!)), ...halfScaled.map((p, i) => sub(p, roots[i]!))],
    gain: bandwidth ** order,
  };
  return zpkToSos(bilinear(analog));
}

/** DSP-3/DSP-6: Butterworth low-pass as second-order sections, same as scipy butter(order, cutoff). */
export function butterLowpass(order: number, cutoffHz: number, rateHz: number): SosSection[] {
  const prototype = butterworthPrototypePoles(order);
  const warped = prewarp(cutoffHz, rateHz);
  // lp2lp_zpk: poles scaled by wo, gain wo^N.
  return zpkToSos(
    bilinear({ zeros: [], poles: prototype.map((p) => scale(p, warped)), gain: warped ** order }),
  );
}

// sosfilt_zi: per-section steady state for a unit step, scaled by the DC gain of the sections before it.
// lfilter_zi for a biquad solves (I − Aᵀ)·zi = b[1:] − a[1:]·b0 in closed form.
function steadyStateUnitStep(sos: SosSection[]): [number, number][] {
  let dcGainBefore = 1;
  return sos.map(([b0, b1, b2, , a1, a2]) => {
    const rhs0 = b1 - a1 * b0;
    const rhs1 = b2 - a2 * b0;
    const z0 = (rhs0 + rhs1) / (1 + a1 + a2);
    const state: [number, number] = [dcGainBefore * z0, dcGainBefore * (rhs1 - a2 * z0)];
    dcGainBefore *= (b0 + b1 + b2) / (1 + a1 + a2);
    return state;
  });
}

// sosfilt: transposed direct form II per section; updates states in place.
function runSections(sos: SosSection[], states: [number, number][], input: ArrayLike<number>): Float64Array {
  const output = new Float64Array(input.length);
  for (let n = 0; n < input.length; n++) {
    let x = input[n]!;
    sos.forEach(([b0, b1, b2, , a1, a2], s) => {
      const state = states[s]!;
      const y = b0 * x + state[0];
      state[0] = b1 * x - a1 * y + state[1];
      state[1] = b2 * x - a2 * y;
      x = y;
    });
    output[n] = x;
  }
  return output;
}

function startStates(sos: SosSection[], level: number): [number, number][] {
  return steadyStateUnitStep(sos).map(([z0, z1]) => [z0 * level, z1 * level]);
}

/** DSP-6: zero-phase forward-backward filtering, same as scipy sosfiltfilt with its default odd padding. */
export function filterZeroPhase(sos: SosSection[], signal: ArrayLike<number>): Float64Array {
  const zeroB2 = sos.filter((section) => section[2] === 0).length;
  const zeroA2 = sos.filter((section) => section[5] === 0).length;
  const padLength = 3 * (2 * sos.length + 1 - Math.min(zeroB2, zeroA2));
  const length = signal.length;
  if (length <= padLength)
    throw new RangeError(`signal has ${length} samples; zero-phase filtering needs more than ${padLength}`);

  // odd_ext: 2·x[0] − x[pad..1] before, 2·x[−1] − x[−2..−pad−1] after.
  const extended = new Float64Array(length + 2 * padLength);
  const first = signal[0]!;
  const last = signal[length - 1]!;
  for (let i = 0; i < padLength; i++) {
    extended[i] = 2 * first - signal[padLength - i]!;
    extended[padLength + length + i] = 2 * last - signal[length - 2 - i]!;
  }
  for (let i = 0; i < length; i++) extended[padLength + i] = signal[i]!;

  const forward = runSections(sos, startStates(sos, extended[0]!), extended);
  forward.reverse();
  const backward = runSections(sos, startStates(sos, forward[0]!), forward);
  backward.reverse();
  return backward.slice(padLength, padLength + length);
}

/** DSP-6: causal biquad filter for the live display, started in steady state at its first sample. */
export class CausalFilter {
  private readonly sos: SosSection[];
  private states: [number, number][] | null = null;

  constructor(sos: SosSection[]) {
    this.sos = sos;
  }

  filter(batch: ArrayLike<number>): Float64Array {
    if (batch.length === 0) return new Float64Array(0);
    // The steady state comes from the first sample ever filtered, so it cannot mismatch the signal.
    this.states ??= startStates(this.sos, batch[0]!);
    return runSections(this.sos, this.states, batch);
  }
}
