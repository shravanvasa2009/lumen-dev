import math
from dataclasses import replace

import numpy as np
import pytest
from scipy.signal import welch

from lumen_dsp.breathing import breathing_rate, breathing_series, welch_psd
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.metrics import MeasuredBeat

DSP13 = DSP_CONFIG["dsp13"]
HALF_BIN_BRPM = 60 * DSP13["seriesRateHz"] / DSP13["welchFftSamples"] / 2


def breathing_beats(seconds, bpm, modulations, first_s=1.0):
    # modulations: {"intensity" | "amplitude" | "interval": (breaths per minute, depth)}.
    def wave(kind, t_s):
        breaths_per_min, depth = modulations[kind]
        return depth * math.sin(2 * math.pi * breaths_per_min * t_s / 60)

    beats = []
    peak_s = first_s
    while peak_s < first_s + seconds:
        beats.append(
            MeasuredBeat(
                peak_s=peak_s,
                beat_class="normal",
                long_pause=False,
                amplitude=0.004 * (1 + wave("amplitude", peak_s)),
                intensity=-0.62 + wave("intensity", peak_s),
                dc=-0.62,
            )
        )
        peak_s += 60 / bpm * (1 - wave("interval", peak_s))
    return beats


def all_at(breaths_per_min):
    return {
        "intensity": (breaths_per_min, 0.002),
        "amplitude": (breaths_per_min, 0.2),
        "interval": (breaths_per_min, 0.05),
    }


def test_welch_is_scipy_welch_with_the_dsp13_parameters():
    series = np.sin(np.arange(300) * 0.37) + 0.01 * np.arange(300)
    spectrum = welch_psd(series)
    frequencies, psd = welch(
        series,
        fs=4,
        window="hann",
        nperseg=128,
        noverlap=64,
        nfft=512,
        detrend="linear",
        return_onesided=True,
        scaling="density",
        average="mean",
    )
    assert spectrum.segments == 3
    np.testing.assert_array_equal(spectrum.frequencies_hz, frequencies)
    np.testing.assert_array_equal(spectrum.psd, psd)
    with pytest.raises(ValueError):
        welch_psd(np.zeros(127))


def test_series_interpolate_onto_the_quarter_second_grid():
    beats = breathing_beats(70, 72, all_at(15), first_s=1.1)
    intensity = breathing_series([beats])["intensity"][0]
    assert intensity.first_index == 5
    first, second = beats[0], beats[1]
    fraction = (1.25 - first.peak_s) / (second.peak_s - first.peak_s)
    assert intensity.values[0] == pytest.approx(
        first.intensity + fraction * (second.intensity - first.intensity), abs=1e-12
    )
    assert breathing_series([beats])["interval"][0].first_index == math.ceil(second.peak_s * 4)


def test_series_skip_atypical_points_and_split_at_artifacts_and_segments():
    beats = breathing_beats(120, 72, all_at(15))
    beats[30] = replace(beats[30], beat_class="atypical", amplitude=0.001)
    beats[40] = replace(beats[40], long_pause=True)
    beats[80] = replace(beats[80], beat_class="artifact")
    series = breathing_series([beats])
    assert [len(series[kind]) for kind in ("intensity", "amplitude", "interval")] == [2, 2, 2]
    assert min(series["amplitude"][0].values) > 0.004 * 0.8 - 1e-12
    two = breathing_series([breathing_beats(50, 72, all_at(15), 1), breathing_beats(50, 72, all_at(15), 60)])
    assert len(two["amplitude"]) == 2


@pytest.mark.parametrize("breaths_per_min", [12, 18])
def test_rate_from_three_agreeing_modulations(breaths_per_min):
    rate = breathing_rate([breathing_beats(120, 72, all_at(breaths_per_min))], 120)
    for estimate in (rate.intensity_brpm, rate.amplitude_brpm, rate.interval_brpm):
        assert abs(estimate - breaths_per_min) <= HALF_BIN_BRPM
    assert rate.rate_brpm == pytest.approx(
        (rate.intensity_brpm + rate.amplitude_brpm + rate.interval_brpm) / 3
    )


@pytest.mark.parametrize("kind", ["intensity", "amplitude", "interval"])
def test_each_modulation_alone_finds_12(kind):
    modulations = {key: (12, 0.0) for key in ("intensity", "amplitude", "interval")}
    modulations[kind] = all_at(12)[kind]
    rate = breathing_rate([breathing_beats(120, 72, modulations)], 120)
    assert abs(getattr(rate, f"{kind}_brpm") - 12) <= HALF_BIN_BRPM


def test_disagreement_reports_nothing_and_agreement_within_4_reports_the_mean():
    apart = breathing_rate(
        [breathing_beats(120, 72, {**all_at(12), "intensity": (24, 0.002)})],
        120,
    )
    assert abs(apart.intensity_brpm - 24) <= HALF_BIN_BRPM
    assert apart.rate_brpm is None
    close = breathing_rate([breathing_beats(120, 72, {**all_at(12), "intensity": (15, 0.002)})], 120)
    assert close.rate_brpm == pytest.approx(
        (close.intensity_brpm + close.amplitude_brpm + close.interval_brpm) / 3
    )


def test_minimum_data():
    beats = [breathing_beats(120, 72, all_at(15))]
    assert breathing_rate(beats, 59.9) is None
    assert breathing_rate(beats, 60) is not None
    short_runs = [
        replace(beat, beat_class="artifact") if i % 30 == 29 else beat
        for i, beat in enumerate(breathing_beats(100, 72, all_at(15)))
    ]
    rate = breathing_rate([short_runs], 90)
    assert (rate.rate_brpm, rate.intensity_brpm, rate.amplitude_brpm, rate.interval_brpm) == (
        None,
        None,
        None,
        None,
    )
