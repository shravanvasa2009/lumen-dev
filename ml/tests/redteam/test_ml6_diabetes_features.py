import math

import numpy as np
import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from lumen_dsp.metrics import MeasuredBeat, hr_summary
from lumen_dsp.shape import PulseShape, ensemble_beat
from lumen_dsp.shape_features import shape_features

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


# A heuristic tolerance, not a derivation: a quarter cycle of the morphology band's 8 Hz upper edge (31 ms),
# about the finest timing the band keeps (as the TS file).
NOTCH_TOLERANCE_S = 1 / (4 * DSP_CONFIG["dsp6"]["morphologyBandHz"][1])


def _constructed_notch_s(pulse, bpm: float) -> tuple[float, float] | None:
    # The notch known from how the pulse is built, on the noiseless raw train before any filtering, as the
    # TS constructedNotch: (notch, diastolic peak) in s after the systolic peak, for the first local minimum
    # after the peak that a local maximum follows, both within 0.6 of the period. 0.1 ms steps.
    period_s = 60 / bpm
    step_s = 1e-4

    def train(t_s: float) -> float:
        return sum(pulse(t_s - n * period_s) for n in range(-2, 3))

    peak_s = max((-0.1 + i * step_s for i in range(round(0.5 / step_s) + 1)), key=train)
    after = [peak_s + i * step_s for i in range(1, round(0.6 * period_s / step_s) + 1)]
    notch_s = next((t for t in after if train(t - step_s) > train(t) <= train(t + step_s)), None)
    if notch_s is None:
        return None
    diastolic_s = next(
        (t for t in after if t > notch_s and train(t - step_s) < train(t) >= train(t + step_s)), None
    )
    return None if diastolic_s is None else (notch_s - peak_s, diastolic_s - peak_s)


def test_older_pulse_at_72_bpm_has_its_notch_and_diastolic_peak_where_built():
    # Observed with the e-wave notch: e-wave 176 after the band's minimum 119; diastolic peak height 0.
    shape = _shape_of(*_morphology_train(OLDER, 72))
    features = shape_features(shape)
    assert features[3] is not None
    constructed = _constructed_notch_s(OLDER, 72)
    assert constructed is not None
    notch_s, diastolic_s = constructed
    samples, lead = DSP_CONFIG["dsp14"]["beatSamples"], DSP_CONFIG["dsp14"]["leadFraction"]
    period_s = 60 / 72
    notch = (features[3] + lead) * samples
    peak = (features[0] + lead) * samples
    checks = {
        "notch_on_constructed_notch": abs(notch - peak - notch_s / period_s * samples)
        <= NOTCH_TOLERANCE_S / period_s * samples,
        "notch_before_diastolic_peak": notch < peak + diastolic_s / period_s * samples,
        "notch_height_in_unit_range": 0 <= features[4] <= 1,
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
