import math

import pytest

from lumen_dsp.metrics import MeasuredBeat, hr_summary

# Mirrors packages/core/test/hr-summary.test.ts: 61 normal beats with intervals alternating 0.8 s and
# 0.9 s, so 60 NN intervals, none dropped by the 20% filter.


def _alternating_beats() -> list[MeasuredBeat]:
    beats = []
    peak_s = 1.0
    for i in range(61):
        if i > 0:
            peak_s += 0.8 if i % 2 == 1 else 0.9
        beats.append(
            MeasuredBeat(
                peak_s=peak_s, beat_class="normal", long_pause=False, amplitude=1.0, intensity=0.0, dc=-1.0
            )
        )
    return beats


def test_summary_over_normal_beats():
    summary = hr_summary([_alternating_beats()], "sinus", 60, 300)
    assert len(summary) == 4
    assert summary[0] == pytest.approx(60 / 0.85, abs=1e-9)
    assert summary[1] == pytest.approx(100, abs=1e-9)
    assert summary[2] == pytest.approx(1000 * math.sqrt(60 * 0.05**2 / 59), abs=1e-9)
    assert summary[3] == 1


def test_hrv_is_none_unless_sinus():
    summary = hr_summary([_alternating_beats()], "af", 60, 300)
    assert summary[0] == pytest.approx(60 / 0.85, abs=1e-9)
    assert summary[1:] == [None, None, None]


def test_hrv_gating_by_fps_and_clean_seconds():
    assert hr_summary([_alternating_beats()], "sinus", 30, 300)[1:] == [None, None, None]
    shorter = hr_summary([_alternating_beats()], "sinus", 60, 120)
    assert shorter[1] == pytest.approx(100, abs=1e-9)
    assert shorter[2] is None
    assert shorter[3] == 1


def test_all_none_below_15_clean_seconds():
    assert hr_summary([_alternating_beats()], "sinus", 60, 10) == [None, None, None, None]
