import math

import pytest

from lumen_dsp.breathing import breathing_estimates, breathing_rate
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.metrics import MeasuredBeat, low_quality_heart_rate, low_quality_rmssd
from lumen_dsp.rhythm import judges_rhythm, reading_wide_window, rhythm_windows
from lumen_dsp.shape import ensemble_beat, low_quality_ensemble_beat

# Mirrors packages/core/test/low-quality.test.ts (ADR 0104) with the same inputs and expected values (§10.2).


def _beats_at(peaks_s: list[float], classes: list[str] | None = None) -> list[MeasuredBeat]:
    return [
        MeasuredBeat(
            peak_s=peak_s,
            beat_class=(classes or [])[i] if classes else "normal",
            long_pause=False,
            amplitude=1.0,
            intensity=0.0,
            dc=-1.0,
        )
        for i, peak_s in enumerate(peaks_s)
    ]


def _alternating(count: int) -> list[float]:
    # Peaks whose intervals alternate 0.8 s and 0.9 s, from 1 s.
    peaks_s = [1.0]
    for i in range(1, count):
        peaks_s.append(peaks_s[i - 1] + (0.8 if i % 2 == 1 else 0.9))
    return peaks_s


def test_heart_rate_from_two_accepted_intervals_with_no_clean_floor():
    assert low_quality_heart_rate([_beats_at(_alternating(3))]) == pytest.approx(60 / 0.85, abs=1e-12)


def test_heart_rate_needs_two_accepted_intervals():
    assert low_quality_heart_rate([_beats_at(_alternating(2))]) is None
    assert low_quality_heart_rate([_beats_at(_alternating(3), ["normal", "artifact", "normal"])]) is None
    assert low_quality_heart_rate([]) is None


def test_heart_rate_leaves_out_a_beat_found_twice_and_never_pairs_across_segments():
    assert low_quality_heart_rate([_beats_at([1, 1, 1.8])]) is None
    across = [_beats_at([1, 1.8]), _beats_at([10, 10.9])]
    assert low_quality_heart_rate(across) == pytest.approx(60 / 0.85, abs=1e-12)


def test_rmssd_from_three_nn_intervals():
    low = low_quality_rmssd([_beats_at(_alternating(4))])
    assert low is not None
    assert low.nn_intervals == 3
    assert low.rmssd_ms == pytest.approx(100, abs=1e-9)


def test_rmssd_needs_three_nn_intervals_and_one_difference():
    assert low_quality_rmssd([_beats_at(_alternating(3))]) is None
    split = _beats_at(
        _alternating(7), ["normal", "normal", "atypical", "normal", "normal", "atypical", "normal"]
    )
    assert low_quality_rmssd([split]) is None


def _intervals(count: int) -> list[float]:
    return [0.8 if i % 2 == 0 else 0.9 for i in range(count)]


def test_reading_wide_window_over_the_longest_usable_run():
    intervals_s = _intervals(14)
    spans = [i == 3 for i in range(14)]
    window = reading_wide_window(intervals_s, spans, [False] * 15)
    assert window is not None
    assert window.start_interval == 4
    assert window.intervals_s == intervals_s[4:]
    assert window.normalized_rmssd == pytest.approx(0.1 / 0.85, abs=1e-12)
    assert window.turning_point_ratio == 1
    assert window.pnn50 == 1
    assert window.atypical_fraction == 0


def test_reading_wide_window_takes_the_first_tie_and_needs_three_intervals():
    spans = [False, False, False, True, False, False, False]
    window = reading_wide_window(_intervals(7), spans, [False] * 8)
    assert window is not None and window.start_interval == 0
    assert reading_wide_window(_intervals(2), [False, False], [False] * 3) is None


def test_reading_wide_window_gives_a_class_only_from_20_intervals():
    def window(count):
        found = reading_wide_window(_intervals(count), [False] * count, [False] * (count + 1))
        assert found is not None
        return found

    assert DSP_CONFIG["lowQuality"]["rhythmClassMinIntervals"] == 20
    assert not judges_rhythm(window(3))
    assert not judges_rhythm(window(19))
    assert judges_rhythm(window(20))
    assert judges_rhythm(window(31))


def test_reading_wide_window_is_none_whenever_a_standard_window_fits():
    size = DSP_CONFIG["dsp15"]["windowIntervals"]
    intervals_s = _intervals(size)
    assert len(rhythm_windows(intervals_s, [False] * size, [False] * (size + 1))) == 1
    assert reading_wide_window(intervals_s, [False] * size, [False] * (size + 1)) is None


def test_reading_wide_window_refuses_what_rhythm_windows_refuses():
    with pytest.raises(ValueError):
        reading_wide_window([0.8, math.nan, 0.8], [False] * 3, [False] * 4)
    with pytest.raises(ValueError):
        reading_wide_window([0.8], [False], [False])


def _modulated_beats() -> list[MeasuredBeat]:
    # 70 s of normal beats at 0.85 s with intensity, amplitude, and interval modulated at 0.25 Hz.
    beats = []
    peak_s = 1.0
    while peak_s < 71:
        breath = math.sin(2 * math.pi * 0.25 * peak_s)
        beats.append(
            MeasuredBeat(
                peak_s=peak_s,
                beat_class="normal",
                long_pause=False,
                amplitude=1 + 0.1 * breath,
                intensity=-0.6 + 0.01 * breath,
                dc=-0.6,
            )
        )
        peak_s += 0.85 + 0.03 * breath
    return beats


def test_breathing_estimates_give_breathing_rates_numbers_at_any_clean_seconds():
    beats = _modulated_beats()
    assert breathing_estimates([beats]) == breathing_rate([beats], 60)
    assert breathing_rate([beats], 59) is None
    assert breathing_estimates([beats]).rate_brpm == pytest.approx(15, abs=0.5)


def test_low_quality_ensemble_beat_averages_like_ensemble_beat_and_below_its_floors():
    rate_hz = DSP_CONFIG["dsp2"]["shapeRateHz"]
    wave = [math.sin(2 * math.pi * k / (0.85 * rate_hz)) for k in range(40 * rate_hz)]
    onsets = [round((0.5 + 0.85 * i) * rate_hz) for i in range(45)]
    normal = [True] * len(onsets)
    low = low_quality_ensemble_beat(wave, onsets, normal)
    standard = ensemble_beat(wave, onsets, normal, 60)
    assert low is not None and standard is not None
    assert low.beats_used == standard.beats_used
    assert list(low.beat) == list(standard.beat)
    assert ensemble_beat(wave, onsets, normal, 30) is None
    three = low_quality_ensemble_beat(wave, onsets[:3], normal[:3])
    assert three is not None and three.beats_used == 2
    assert low_quality_ensemble_beat(wave, onsets[:1], normal[:1]) is None
    with pytest.raises(ValueError):
        low_quality_ensemble_beat(wave, onsets, normal[1:])
