import pytest

from lumen_dsp.tests.synthetic import capture_at, jittered_offsets, regular_offsets
from lumen_dsp.timebase import build_timebase


def flat(_t_s: float) -> tuple[float, float, float]:
    return 0.6, 0.1, 0.05


def test_converts_native_ns_to_seconds_from_capture_start():
    timebase = build_timebase(*capture_at(regular_offsets(60, 1), flat))
    assert timebase.t_s[0] == 0
    assert timebase.t_s[59] == pytest.approx(59 / 60, abs=1e-9)
    assert timebase.median_frame_interval_s == pytest.approx(1 / 60, abs=1e-9)
    assert timebase.dropped_gap_starts.tolist() == []


def test_carries_exposure_and_channel_values_per_frame():
    samples, stats = capture_at(regular_offsets(30, 1), lambda t_s: (t_s, 0.2, 0.1), exposure_ns=4_000_000)
    timebase = build_timebase(samples, stats)
    assert timebase.exposure_ns.tolist() == [4_000_000] * 30
    assert timebase.r[15] == pytest.approx(0.5, abs=1e-9)
    assert timebase.g[15] == 0.2


def test_jitter_under_the_limit_is_not_dropped():
    timebase = build_timebase(*capture_at(jittered_offsets(60, 5, 0.002), flat))
    assert timebase.dropped_gap_starts.tolist() == []


def test_gap_over_1_5x_median_is_dropped_frames():
    offsets = [offset for k, offset in enumerate(regular_offsets(60, 2)) if k not in (30, 91, 92)]
    assert build_timebase(*capture_at(offsets, flat)).dropped_gap_starts.tolist() == [29, 89]


def test_rejects_timestamps_that_do_not_strictly_increase():
    with pytest.raises(ValueError, match="strictly increase"):
        build_timebase(*capture_at([0, 1 / 60, 1 / 60, 3 / 60], flat))


def test_rejects_stats_that_do_not_line_up_with_samples():
    samples, stats = capture_at(regular_offsets(60, 1), flat)
    shifted_stats = {key: column[1:] for key, column in stats.items()}
    with pytest.raises(ValueError, match="frame stats"):
        build_timebase(samples, shifted_stats)
