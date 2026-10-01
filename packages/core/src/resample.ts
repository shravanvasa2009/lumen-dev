import { DSP_CONFIG } from './config';

// Timestamps are whole ns, so a gap within half a ns of the limit equals it. A difference of two times in
// seconds carries rounding up to ~1e-13 s (10-minute captures), which would split some 150 ms gaps.
const HALF_NS_S = 0.5e-9;

export interface ResampledSegment {
  firstIndex: number; // sample k is at (firstIndex + k) / rate seconds from capture start
  values: Float64Array;
}

// Second derivatives of the natural cubic spline (M[0] = M[n-1] = 0) through (x, y), by the Thomas
// algorithm; the system is strictly diagonally dominant, so no pivoting is needed. Same interpolant as
// scipy.interpolate.CubicSpline(x, y, bc_type='natural').
function naturalSecondDerivatives(x: Float64Array, y: Float64Array): Float64Array {
  const n = x.length;
  const secondDerivatives = new Float64Array(n);
  if (n < 3) return secondDerivatives;
  const superDiagonal = new Float64Array(n);
  const rhs = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const hLeft = x[i]! - x[i - 1]!;
    const hRight = x[i + 1]! - x[i]!;
    const slopeChange = (y[i + 1]! - y[i]!) / hRight - (y[i]! - y[i - 1]!) / hLeft;
    const pivot = 2 * (hLeft + hRight) - hLeft * superDiagonal[i - 1]!;
    superDiagonal[i] = hRight / pivot;
    rhs[i] = (6 * slopeChange - hLeft * rhs[i - 1]!) / pivot;
  }
  for (let i = n - 2; i >= 1; i--) {
    secondDerivatives[i] = rhs[i]! - superDiagonal[i]! * secondDerivatives[i + 1]!;
  }
  return secondDerivatives;
}

function splineOnGrid(x: Float64Array, y: Float64Array, rateHz: number): ResampledSegment | null {
  // Grid times are k / rate from capture start, so every segment and channel shares one grid. Python
  // must use the same expressions (ceil(x0·rate), floor(xn·rate)) to land on the same indices.
  // Times are k / rate (divide, never step 1/rate): Python must use np.arange(first, last + 1) / rate.
  const firstIndex = Math.ceil(x[0]! * rateHz);
  const lastIndex = Math.floor(x[x.length - 1]! * rateHz);
  if (lastIndex < firstIndex) return null;
  const m = naturalSecondDerivatives(x, y);
  const values = new Float64Array(lastIndex - firstIndex + 1);
  let knot = 0;
  for (let k = 0; k < values.length; k++) {
    const t = (firstIndex + k) / rateHz;
    while (knot < x.length - 2 && t > x[knot + 1]!) knot++;
    const h = x[knot + 1]! - x[knot]!;
    const dx = t - x[knot]!;
    const m0 = m[knot]!;
    const m1 = m[knot + 1]!;
    const slope = (y[knot + 1]! - y[knot]!) / h;
    // Power form in dx from the left knot, as scipy's PPoly evaluates: a constant has slope 0 and m = 0,
    // so it comes out exactly as y0. A form weighting both knots rounds a flat signal into ~1e-16 noise.
    values[k] =
      y[knot]! + dx * (slope - (h * (2 * m0 + m1)) / 6 + dx * (m0 / 2 + (dx * (m1 - m0)) / (6 * h)));
  }
  return { firstIndex, values };
}

/** DSP-2: natural cubic spline onto a uniform grid, split wherever frames are > 150 ms apart. */
export function resampleCubic(tS: Float64Array, values: Float64Array, rateHz: number): ResampledSegment[] {
  // scipy CubicSpline's refusals (§10.2 parity), on the whole input so a skipped segment hides nothing.
  if (values.length !== tS.length) throw new RangeError(`${tS.length} times but ${values.length} values`);
  for (let i = 0; i < tS.length; i++) {
    if (!Number.isFinite(tS[i]!) || !Number.isFinite(values[i]!))
      throw new RangeError(`frame ${i}: time and value must be finite`);
    if (i > 0 && !(tS[i]! > tS[i - 1]!))
      throw new RangeError(`times must strictly increase; frame ${i} does not`);
  }
  const segments: ResampledSegment[] = [];
  let segmentStart = 0;
  for (let i = 1; i <= tS.length; i++) {
    const endsSegment = i === tS.length || tS[i]! - tS[i - 1]! > DSP_CONFIG.dsp2.maxGapS + HALF_NS_S;
    if (!endsSegment) continue;
    // A lone frame between two long gaps cannot carry a spline and is left out.
    if (i - segmentStart >= 2) {
      const segment = splineOnGrid(tS.subarray(segmentStart, i), values.subarray(segmentStart, i), rateHz);
      if (segment) segments.push(segment);
    }
    segmentStart = i;
  }
  return segments;
}
