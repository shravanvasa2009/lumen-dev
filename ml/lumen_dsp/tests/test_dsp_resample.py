import math

import numpy as np
import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.resample import ResampledSegment, resample_cubic
from lumen_dsp.tests.synthetic import capture_at, jittered_offsets, regular_offsets, sine
from lumen_dsp.timebase import build_timebase

MODEL_RATE_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
SHAPE_RATE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]


def timebase_of(offsets_s, waveform):
    return build_timebase(*capture_at(offsets_s, lambda t_s: (waveform(t_s), 0.1, 0.05)))


def max_error(segment: ResampledSegment, rate_hz: float, truth, from_s: float, to_s: float) -> float:
    t_s = (segment.first_index + np.arange(len(segment.values))) / rate_hz
    inside = (t_s >= from_s) & (t_s <= to_s)
    return float(np.max(np.abs(segment.values[inside] - np.vectorize(truth)(t_s[inside]))))


# Same bounds and reasoning as packages/core/test/resample.test.ts: (5/384)·h⁴·ω⁴ in the interior.
@pytest.mark.parametrize("rate_hz", [MODEL_RATE_HZ, SHAPE_RATE_HZ])
def test_reproduces_a_sine_from_60_fps_within_the_spline_bound(rate_hz):
    timebase = timebase_of(regular_offsets(60, 10), sine)
    segments = resample_cubic(timebase.t_s, timebase.r, rate_hz)
    assert len(segments) == 1
    assert max_error(segments[0], rate_hz, sine, 0.5, 9.4) < 1e-5


def test_reproduces_a_sine_from_jittered_timestamps():
    timebase = timebase_of(jittered_offsets(60, 10, 0.002), sine)
    (segment,) = resample_cubic(timebase.t_s, timebase.r, SHAPE_RATE_HZ)
    assert max_error(segment, SHAPE_RATE_HZ, sine, 0.5, 9.4) < 2e-5


def test_reproduces_a_straight_line_exactly():
    def ramp(t_s):
        return 0.4 + 0.03 * t_s

    timebase = timebase_of(jittered_offsets(30, 4, 0.005), ramp)
    (segment,) = resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)
    assert max_error(segment, MODEL_RATE_HZ, ramp, 0, 4) < 1e-12


def test_grid_is_k_over_rate_from_capture_start():
    timebase = timebase_of(regular_offsets(60, 10), sine)
    (segment,) = resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)
    assert segment.first_index == 0
    assert len(segment.values) == 639


def test_grid_uses_ceil_and_floor_of_the_segment_ends():
    timebase = timebase_of([0.01, 0.05, 0.09], sine)
    (segment,) = resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)
    assert segment.first_index == math.ceil(timebase.t_s[0] * MODEL_RATE_HZ)
    assert segment.first_index + len(segment.values) - 1 == math.floor(timebase.t_s[-1] * MODEL_RATE_HZ)


def test_splits_at_a_200_ms_gap():
    before = regular_offsets(60, 2)
    after = [before[-1] + 0.2 + offset for offset in regular_offsets(60, 2)]
    timebase = timebase_of(before + after, sine)
    first, second = resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)
    assert (first.first_index + len(first.values) - 1) / MODEL_RATE_HZ <= before[-1]
    assert second.first_index / MODEL_RATE_HZ >= after[0]


def test_bridges_a_140_ms_gap():
    before = regular_offsets(60, 2)
    after = [before[-1] + 0.14 + offset for offset in regular_offsets(60, 2)]
    timebase = timebase_of(before + after, sine)
    assert len(resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)) == 1


def test_bridges_a_gap_of_exactly_150_ms():
    # 0.18 s then 0.33 s: the seconds difference rounds to just over 0.15.
    before = [k * 0.02 for k in range(10)]
    after = [0.33 + k * 0.02 for k in range(10)]
    timebase = timebase_of(before + after, sine)
    assert len(resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)) == 1


def test_two_frame_segment_is_a_straight_line():
    before = regular_offsets(60, 1)
    pair = [before[-1] + 0.3, before[-1] + 0.35]
    after = [pair[1] + 0.3 + offset for offset in regular_offsets(60, 1)]
    timebase = timebase_of(before + pair + after, sine)
    segments = resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)
    assert len(segments) == 3
    middle = segments[1]
    (t1, t2), (y1, y2) = timebase.t_s[60:62], timebase.r[60:62]
    t_s = (middle.first_index + np.arange(len(middle.values))) / MODEL_RATE_HZ
    assert len(middle.values) >= 3
    assert np.max(np.abs(middle.values - (y1 + (y2 - y1) * (t_s - t1) / (t2 - t1)))) < 1e-15


def test_drops_a_lone_frame_between_two_long_gaps():
    before = regular_offsets(60, 1)
    lone = before[-1] + 0.3
    after = [lone + 0.3 + offset for offset in regular_offsets(60, 1)]
    timebase = timebase_of([*before, lone, *after], sine)
    assert len(resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)) == 2


# Same refusals as packages/core resampleCubic and scipy CubicSpline, checked before any segment is
# skipped, so a bad frame in a lone-frame or empty-grid segment is not silently dropped.
TIMES_S = np.array([0, 0.03, 0.06, 0.09, 0.12])
CHANNEL = np.array([-0.6, -0.61, -0.6, -0.59, -0.6])


@pytest.mark.parametrize(
    ("times_s", "channel"),
    [
        (TIMES_S, np.array([-0.6, math.nan, -0.6, -0.59, -0.6])),
        (TIMES_S, np.array([-0.6, -0.61, math.inf, -0.59, -0.6])),
        (np.array([0, math.nan, 0.06, 0.09, 0.12]), CHANNEL),
        (np.array([0, 0.03, 0.03, 0.09, 0.12]), CHANNEL),
        (TIMES_S[::-1].copy(), CHANNEL),
        (TIMES_S, CHANNEL[:3]),
        # A 2-frame segment with no grid point and a lone frame after a long gap: both would be skipped.
        (np.array([0.115, 0.11]), np.array([1.0, 2.0])),
        (np.array([0, 0.03, 0.5]), np.array([-0.6, -0.6, math.nan])),
    ],
)
def test_rejects_non_finite_unordered_or_misaligned_input(times_s, channel):
    with pytest.raises(ValueError):
        resample_cubic(times_s, channel, MODEL_RATE_HZ)


def test_keeps_a_constant_exactly_constant():
    timebase = timebase_of(jittered_offsets(30, 10, 0.002), lambda _t_s: 1.0)
    (segment,) = resample_cubic(timebase.t_s, timebase.r, MODEL_RATE_HZ)
    assert set(segment.values.tolist()) == {1.0}
