import numpy as np
import pytest

from lumen_dsp.beat_classes import ClassifiedBeat
from train.hr_summary import hr_summary


def beats_at(peaks_s, classes=None, long_pauses=()) -> list[ClassifiedBeat]:
    classes = classes or {}
    return [
        ClassifiedBeat(
            peak_s=peak_s,
            onset_s=peak_s - 0.1,
            beat_class=classes.get(i, "normal"),
            long_pause=i in long_pauses,
        )
        for i, peak_s in enumerate(peaks_s)
    ]


def test_steady_rhythm():
    (hr, rmssd, sdnn, pnn50), nn = hr_summary(beats_at(np.arange(60) * 1.0))
    assert hr == pytest.approx(60)
    assert rmssd == pytest.approx(0, abs=1e-9) and sdnn == pytest.approx(0, abs=1e-9) and pnn50 == 0
    assert nn == 59


def test_alternating_intervals():
    intervals = [0.95, 1.05] * 20
    (hr, rmssd, sdnn, pnn50), nn = hr_summary(beats_at(np.concatenate([[0], np.cumsum(intervals)])))
    assert hr == pytest.approx(60)
    # Every successive difference is ±100 ms.
    assert rmssd == pytest.approx(100) and pnn50 == 1.0
    assert sdnn == pytest.approx(1000 * np.std(intervals, ddof=1))
    assert nn == 40


def test_artifact_beat_removes_both_of_its_intervals_from_hr():
    # Intervals 1.0 s except the two around beat 5, which is moved 0.4 s early (0.6 and 1.4 s).
    peaks = np.arange(12) * 1.0
    peaks[5] -= 0.4
    (hr, *_), _ = hr_summary(beats_at(peaks, classes={5: "artifact"}))
    assert hr == pytest.approx(60)


def test_not_a_beat_is_skipped_and_an_interval_spans_it():
    peaks = list(np.arange(10) * 1.0)
    peaks.insert(4, 3.3)
    (hr, rmssd, _, _), nn = hr_summary(beats_at(peaks, classes={4: "not-a-beat"}))
    assert hr == pytest.approx(60) and rmssd == pytest.approx(0, abs=1e-9) and nn == 9


def test_long_pause_and_atypical_beats_leave_the_nn_intervals():
    peaks = np.arange(20) * 1.0
    (_, rmssd, _, _), nn = hr_summary(beats_at(peaks, classes={8: "atypical"}, long_pauses={14}))
    # Lost: the two intervals touching beat 8 and the interval ending at beat 14.
    assert nn == 19 - 3
    assert rmssd == pytest.approx(0, abs=1e-9)


def test_twenty_percent_filter_drops_an_outlier_without_bridging_it():
    intervals = [1.0] * 6 + [1.5] + [1.1] * 6
    (_, rmssd, _, _), nn = hr_summary(beats_at(np.concatenate([[0], np.cumsum(intervals)])))
    assert nn == 12
    # Only the 1.0 → 1.0 and 1.1 → 1.1 differences remain; the dropped 1.5 s splits the run, so no
    # 1.0 → 1.1 difference exists.
    assert rmssd == pytest.approx(0, abs=1e-9)


def test_too_few_beats_gives_nulls():
    assert hr_summary(beats_at([0.0])) == ([None, None, None, None], 0)
    values, nn = hr_summary(beats_at([0.0, 1.0]))
    assert values[0] == pytest.approx(60) and values[1:] == [None, None, None] and nn == 1
