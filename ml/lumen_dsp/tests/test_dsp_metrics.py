import math
import statistics
from dataclasses import replace

import numpy as np
import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.metrics import MeasuredBeat, clean_seconds, heart_rate, hrv, measure_beats, perfusion_index
from lumen_dsp.resample import ResampledSegment
from lumen_dsp.tests.synthetic import park_miller_uniforms


def beats_from(intervals_s, classes=None, long_pauses=(), first_s=1.0):
    times = [first_s]
    for interval_s in intervals_s:
        times.append(times[-1] + interval_s)
    classes = classes or {}
    return [
        MeasuredBeat(
            peak_s=peak_s,
            beat_class=classes.get(i, "normal"),
            long_pause=i in long_pauses,
            amplitude=0.004,
            intensity=-0.62,
            dc=-0.62,
        )
        for i, peak_s in enumerate(times)
    ]


def alternating(count, low, high):
    return [low if k % 2 == 0 else high for k in range(count)]


def test_clean_seconds_subtract_the_union_of_spans_clipped_to_the_reading():
    assert clean_seconds(2, 92, []) == 90
    spans = [(10, 14), (12, 15), (0, 3), (90, 99), (40, 40)]
    assert clean_seconds(2, 92, spans) == pytest.approx(82, abs=1e-12)
    assert clean_seconds(0, 30, [(-1, 31)]) == 0


def test_heart_rate_regular_and_af_like():
    assert heart_rate([beats_from([60 / 72] * 30)], 30) == pytest.approx(72, abs=1e-9)
    intervals_s = [0.4 + 0.8 * u for u in park_miller_uniforms(80, 4242)]
    assert heart_rate([beats_from(intervals_s)], 70) == pytest.approx(
        60 / statistics.median(intervals_s), abs=1e-9
    )


def test_heart_rate_keeps_atypical_and_long_pauses_and_drops_intervals_touching_an_artifact():
    intervals_s = [0.8] * 20
    intervals_s[4] = 0.5
    intervals_s[9] = intervals_s[10] = 0.3
    beats = beats_from(intervals_s, {5: "atypical", 10: "artifact"}, long_pauses=(15,))
    kept = [interval_s for k, interval_s in enumerate(intervals_s) if k not in (9, 10)]
    assert heart_rate([beats], 20) == pytest.approx(60 / statistics.median(kept), abs=1e-9)


def test_heart_rate_skips_not_a_beat_and_never_bridges_segments():
    beats = beats_from([1.0] * 20)
    candidate = replace(beats[3], peak_s=beats[3].peak_s + 0.3, beat_class="not-a-beat")
    assert heart_rate([[*beats[:4], candidate, *beats[4:]]], 20) == pytest.approx(60, abs=1e-9)
    first, second = beats_from([1.0] * 10, first_s=1), beats_from([1.0] * 10, first_s=15)
    assert heart_rate([first, second], 20) == pytest.approx(60, abs=1e-9)


def test_heart_rate_needs_15_clean_seconds_and_an_interval():
    beats = beats_from([0.8] * 20)
    assert heart_rate([beats], 14.999) is None
    assert heart_rate([beats], math.nan) is None
    assert heart_rate([beats], 15) == pytest.approx(75, abs=1e-9)
    assert heart_rate([beats_from([])], 60) is None


def test_heart_rate_leaves_out_zero_and_negative_intervals():
    # A beat detected twice, or out of order; the median of 0.8 and 0.9 is 0.85 (0.4 with the other two).
    assert heart_rate([beats_from([0.0])], 60) is None
    assert heart_rate([beats_from([0.8, 0.0, -0.1, 0.9])], 60) == pytest.approx(60 / 0.85, abs=1e-9)


def test_perfusion_index_known_ac_dc_and_median_over_normal_beats():
    beats = [replace(beat, amplitude=0.005) for beat in beats_from([1.0] * 40)]
    assert perfusion_index([beats], 40) == pytest.approx(100 * 0.005 / 0.62, abs=1e-12)
    amplitudes = [0.004, 0.006, 0.005, 0.1, 0.0001]
    classes = ["normal", "normal", "normal", "atypical", "artifact"]
    mixed = [
        replace(beat, beat_class=classes[i], amplitude=amplitudes[i], dc=-0.5)
        for i, beat in enumerate(beats_from([1.0] * 4))
    ]
    later = [replace(beat, amplitude=0.007, dc=-0.5) for beat in beats_from([1.0], first_s=20)]
    assert perfusion_index([mixed, later], 30) == pytest.approx(1.2, abs=1e-12)


def test_perfusion_index_needs_30_clean_seconds_and_a_normal_beat():
    beats = beats_from([1.0] * 40)
    assert perfusion_index([beats], 29.9) is None
    assert perfusion_index([beats], math.nan) is None
    assert perfusion_index([[replace(beat, beat_class="atypical") for beat in beats]], 40) is None


def test_measure_beats_reads_intensity_and_dc_at_the_peak_sample():
    rate = DSP_CONFIG["dsp2"]["shapeRateHz"]
    values = np.array([-0.7 + 0.2 * k / (20 * rate) for k in range(20 * rate)])
    raw = ResampledSegment(first_index=512, values=values)
    measured = measure_beats([5.0, 12.0019], ["normal", "normal"], [False, False], [0.003, 0.004], raw)
    assert measured[0].intensity == values[768]
    assert measured[1].intensity == values[2560]
    assert measured[0].amplitude == 0.003
    assert measured[0].dc == pytest.approx(values[768], abs=5e-5)
    assert measured[1].dc == pytest.approx(values[2560], abs=5e-5)
    with pytest.raises(ValueError):
        measure_beats([1.0], [], [], [], raw)


def test_hrv_known_rmssd_sdnn_pnn50():
    values = hrv([beats_from(alternating(400, 0.8, 0.84))], "sinus", 60, 330)
    assert values.nn_intervals == 400
    assert values.rmssd_ms == pytest.approx(40, abs=1e-9)
    assert values.sdnn_ms == pytest.approx(20 * math.sqrt(400 / 399), abs=1e-9)
    assert values.pnn50 == 0
    assert hrv([beats_from(alternating(80, 0.8, 0.86))], "sinus", 60, 70).pnn50 == 1
    mixed = [[0.8, 0.86, 0.82, 0.86][k % 4] for k in range(81)]
    assert hrv([beats_from(mixed)], "sinus", 60, 70).pnn50 == 0.5


def test_hrv_20_percent_filter():
    intervals_s = alternating(80, 0.8, 0.84)
    intervals_s[40] = 1.2  # neighbours' median 0.84 s
    values = hrv([beats_from(intervals_s)], "sinus", 60, 70)
    assert values.nn_intervals == 79
    assert values.rmssd_ms == pytest.approx(40, abs=1e-9)

    def kept_with(ratio):
        edited = alternating(80, 0.8, 0.84)
        edited[41] = 0.8 * ratio  # neighbours' median 0.80 s
        return hrv([beats_from(edited)], "sinus", 60, 70).nn_intervals

    assert [kept_with(ratio) for ratio in (1.19, 0.81, 1.21, 0.79)] == [80, 80, 79, 79]


def test_hrv_uses_normal_to_normal_intervals_only():
    beats = beats_from(alternating(90, 0.8, 0.84), {20: "atypical", 50: "artifact"}, long_pauses=(70,))
    values = hrv([beats], "sinus", 60, 75)
    assert values.nn_intervals == 85
    assert values.rmssd_ms == pytest.approx(40, abs=1e-9)
    two = hrv([beats_from([0.8] * 30), beats_from([1.0] * 30, first_s=40)], "sinus", 60, 65)
    assert two.nn_intervals == 60
    assert two.rmssd_ms == pytest.approx(0, abs=1e-9)


def test_hrv_gates():
    beats = [beats_from(alternating(80, 0.8, 0.84))]
    assert hrv(beats, "af", 60, 70) is None
    assert hrv(beats, "other", 60, 70) is None
    assert hrv(beats, "sinus", 59.9, 70) is None
    assert hrv(beats, "sinus", math.nan, 70) is None
    assert hrv(beats, "sinus", math.inf, 70) is None
    fifty = [beats_from(alternating(50, 0.8, 0.84))]
    assert hrv(fifty, "sinus", 60, 60).rmssd_ms == pytest.approx(40, abs=1e-9)
    assert hrv(fifty, "sinus", 60, 59.9).rmssd_ms is None
    forty_nine = hrv([beats_from(alternating(49, 0.8, 0.84))], "sinus", 60, 120)
    assert (forty_nine.rmssd_ms, forty_nine.pnn50, forty_nine.sdnn_ms) == (None, None, None)
    long = [beats_from(alternating(400, 0.8, 0.84))]
    assert hrv(long, "sinus", 60, 299.9).sdnn_ms is None
    assert hrv(long, "sinus", 60, 300).sdnn_ms is not None
