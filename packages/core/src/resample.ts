import { DSP_CONFIG } from './config';

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
  const firstIndex = Math.ceil(x[0]! * rateHz);
  const lastIndex = Math.floor(x[x.length - 1]! * rateHz);
  if (lastIndex < firstIndex) return null;
  const m = naturalSecondDerivatives(x, y);
  const values = new Float64Array(lastIndex - firstIndex + 1);
  let knot = 0;
  for (let k = 0; k < values.length; k++) {
    const t = (firstIndex + k) / rateHz;
    while (knot < x.length - 2 && t > x[knot + 1]!) knot++;
    const x0 = x[knot]!;
    const x1 = x[knot + 1]!;
    const h = x1 - x0;
    const toRight = x1 - t;
    const fromLeft = t - x0;
    values[k] =
      (m[knot]! * toRight ** 3 + m[knot + 1]! * fromLeft ** 3) / (6 * h) +
      (y[knot]! / h - (m[knot]! * h) / 6) * toRight +
      (y[knot + 1]! / h - (m[knot + 1]! * h) / 6) * fromLeft;
  }
  return { firstIndex, values };
}

/** DSP-2: natural cubic spline onto a uniform grid, split wherever frames are > 150 ms apart. */
export function resampleCubic(tS: Float64Array, values: Float64Array, rateHz: number): ResampledSegment[] {
  const segments: ResampledSegment[] = [];
  let segmentStart = 0;
  for (let i = 1; i <= tS.length; i++) {
    const endsSegment = i === tS.length || tS[i]! - tS[i - 1]! > DSP_CONFIG.dsp2.maxGapS;
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
