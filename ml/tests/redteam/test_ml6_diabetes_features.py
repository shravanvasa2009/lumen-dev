import math

import numpy as np
import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from lumen_dsp.metrics import MeasuredBeat, hr_summary
from lumen_dsp.shape import PulseShape, ensemble_beat
from lumen_dsp.shape_features import shape_features, systolic_peak_index

# Red team (§16) for ML-6, mirroring packages/core/test/redteam/ml6-diabetes-features.test.ts on the inputs
# both sides can build without the camera path. Each test failed when it was written.

RATE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]
BEATS = 30


def _gaussian(t_s: float, sigma_s: float) -> float:
    return math.exp(-0.5 * (t_s / sigma_s) ** 2)


def _runoff(decay_s: float, hump_ratio: float, delay_s: float, hump_sigma_s: float):
    # packages/core/test/synthetic-suite/frames.ts runoff with its default 60 ms rise.
    def pulse(t_s: float) -> float:
        systolic = _gaussian(t_s, 0.06) if t_s < 0 else math.exp(-t_s / decay_s)
        return systolic + hump_ratio * _gaussian(t_s - delay_s, hump_sigma_s)

    return pulse


# Class 2–3 finger pulse at age ~60 (the TS file's "older" pulse at 72 bpm).
OLDER = _runoff(0.3, 0.25, 0.147 + 0.05, 0.06)
# Class 2 adult (the TS file's "adult" pulse at 72 bpm).
ADULT = _runoff(0.2, 0.4, 0.27, 0.06)


def _morphology_train(pulse, bpm: float) -> tuple[np.ndarray, list[int]]:
    # 0.5–8 Hz band at 256 Hz; each onset is the band's minimum in the 0.3 s before its peak (as DSP-8).
    period_s = 60 / bpm
    peaks_s = [1 + i * period_s for i in range(BEATS)]
    raw = [
        sum(pulse(k / RATE_HZ - peak_s) for peak_s in peaks_s)
        for k in range(round((BEATS * period_s + 2) * RATE_HZ))
    ]
    dsp6 = DSP_CONFIG["dsp6"]
    band = np.asarray(
        filter_zero_phase(butter_bandpass(dsp6["morphologyOrder"], *dsp6["morphologyBandHz"], RATE_HZ), raw)
    )
    onsets = []
    for peak_s in peaks_s:
        onset = round((peak_s - 0.3) * RATE_HZ)
        for k in range(onset, round(peak_s * RATE_HZ) + 1):
            if band[k] < band[onset]:
                onset = k
        onsets.append(onset)
    return band, onsets


def _shape_of(band, onsets: list[int], capture_fps: float = 60) -> PulseShape | None:
    return ensemble_beat(band, onsets, [True] * len(onsets), capture_fps)


def _visible_notch(smoothed, systolic_peak: int) -> tuple[int, int] | None:
    # The first local minimum after the systolic peak that a local maximum (the diastolic peak) follows.
    for k in range(systolic_peak + 1, len(smoothed) - 1):
        if not smoothed[k - 1] > smoothed[k] <= smoothed[k + 1]:
            continue
        for j in range(k + 1, len(smoothed) - 1):
            if smoothed[j - 1] < smoothed[j] >= smoothed[j + 1]:
                return k, j
        return None
    return None


def test_older_pulse_at_72_bpm_has_a_physiological_notch():
    # Observed: e-wave 176 after the visible notch 119 and the diastolic peak 130; diastolic peak height 0.
    shape = _shape_of(*_morphology_train(OLDER, 72))
    features = shape_features(shape)
    assert features[3] is not None
    visible = _visible_notch(shape.smoothed, systolic_peak_index(shape.smoothed))
    assert visible is not None
    notch = round((features[3] + DSP_CONFIG["dsp14"]["leadFraction"]) * DSP_CONFIG["dsp14"]["beatSamples"])
    checks = {
        "notch_before_diastolic_peak": notch < visible[1],
        "notch_at_or_above_onset": features[4] >= 0,
        "diastolic_peak_found": features[5] > 0,
        "diastolic_peak_not_below_notch": features[5] >= features[4],
        "positive_area_ratio": features[11] > 0,
    }
    assert checks == dict.fromkeys(checks, True)


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_one_non_finite_sample_never_reaches_diabetes_net(bad):
    # Observed: NaN and +inf give a beat with non-finite samples and non-null features from the
    # contaminated average (packages/core gives an all-NaN beat and all-null features); -inf raises
    # ValueError in scipy savgol_filter.
    band, onsets = _morphology_train(ADULT, 72)
    band[2000] = bad
    shape = _shape_of(band, onsets)
    if shape is None:
        return
    assert np.all(np.isfinite(shape.beat))
    assert all(value is None or math.isfinite(value) for value in shape_features(shape))


def test_nan_capture_fps_is_refused():
    band, onsets = _morphology_train(ADULT, 72)
    assert _shape_of(band, onsets, math.nan) is None


def _beat(peak_s: float) -> MeasuredBeat:
    return MeasuredBeat(
        peak_s=peak_s, beat_class="normal", long_pause=False, amplitude=1.0, intensity=0.0, dc=-1.0
    )


def _alternating() -> list[list[MeasuredBeat]]:
    # 81 normal beats alternating 0.9 / 0.8 s: 80 NN intervals.
    beats = [_beat(1.0)]
    for i in range(80):
        beats.append(_beat(beats[-1].peak_s + (0.8 if i % 2 else 0.9)))
    return [beats]


def test_nan_capture_fps_nulls_hrv():
    assert hr_summary(_alternating(), "sinus", math.nan, 300)[1:] == [None, None, None]


def test_nan_clean_seconds_nulls_everything():
    assert hr_summary(_alternating(), "sinus", 60, math.nan) == [None, None, None, None]


def test_two_beats_at_the_same_time_give_no_heart_rate():
    # Observed: ZeroDivisionError here; packages/core returns Infinity.
    assert hr_summary([[_beat(1.0), _beat(1.0)]], "sinus", 60, 300)[0] is None
