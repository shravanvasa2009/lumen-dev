import math
from dataclasses import dataclass

import numpy as np
from scipy.interpolate import CubicSpline

from lumen_dsp.config import DSP_CONFIG

# Timestamps are whole ns, so a gap within half a ns of the limit equals it. A difference of two times in
# seconds carries rounding up to ~1e-13 s (10-minute captures), which would split some 150 ms gaps.
HALF_NS_S = 0.5e-9


@dataclass(frozen=True)
class ResampledSegment:
    first_index: int  # sample k is at (first_index + k) / rate seconds from capture start
    values: np.ndarray


# DSP-2: natural cubic spline onto a k / rate grid, split wherever frames are > 150 ms apart.
def resample_cubic(t_s: np.ndarray, values: np.ndarray, rate_hz: float) -> list[ResampledSegment]:
    max_gap_s = DSP_CONFIG["dsp2"]["maxGapS"]
    breaks = np.flatnonzero(np.diff(t_s) > max_gap_s + HALF_NS_S) + 1
    segments = []
    for start, stop in zip(np.r_[0, breaks], np.r_[breaks, len(t_s)], strict=True):
        # A lone frame between two long gaps cannot carry a spline and is left out.
        if stop - start < 2:
            continue
        knots = t_s[start:stop]
        first = math.ceil(knots[0] * rate_hz)
        last = math.floor(knots[-1] * rate_hz)
        if last < first:
            continue
        # Same grid expression as packages/core: divide k by the rate, never step by 1 / rate.
        grid_s = np.arange(first, last + 1) / rate_hz
        spline = CubicSpline(knots, values[start:stop], bc_type="natural")
        segments.append(ResampledSegment(first_index=first, values=spline(grid_s)))
    return segments
