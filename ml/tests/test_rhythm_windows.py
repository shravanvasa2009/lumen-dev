import numpy as np
import pandas as pd
import pytest

from datasets.build_intervals import MAX_INTERVAL_S, MIN_INTERVAL_S
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.rhythm import RHYTHM_FEATURE_NAMES, rhythm_feature_vector, rhythm_v2_features, rhythm_windows
from nets.rhythm_net import FEATURES, INTERVALS, LABELS
from train import rhythm_windows as windows_module
from train.rhythm_windows import (
    ATYPICAL_INDEX,
    FEATURE_NAMES,
    NEUTRAL_ATYPICAL_FRACTION,
    build_window_set,
    cut_readings,
    load_window_set,
    save_window_set,
    window_inputs,
)

SIZE = DSP_CONFIG["dsp15"]["windowIntervals"]
STEP = DSP_CONFIG["dsp15"]["windowStep"]


def episode(dataset, subject, label, intervals_ms, premature=None, number=0):
    intervals_ms = list(map(float, intervals_ms))
    return {
        "dataset": dataset,
        "subject": subject,
        "record": subject,
        "episode": number,
        "label": label,
        "intervals_ms": intervals_ms,
        "premature": premature if premature is not None else [False] * len(intervals_ms),
        "r_peak_sample_rate": 250.0,
    }


def irregular(count, seed):
    return np.random.default_rng(seed).uniform(400, 1100, count)


def dsp_features(window):
    # ADR 0079: the DSP-15 vector, then the 7 rhythm v2 features, both from lumen_dsp.
    return rhythm_feature_vector(window) + rhythm_v2_features(window)


def neutralized(features):
    # v1 replaces the atypical-beat fraction with a constant; every other feature is lumen_dsp's.
    features = np.array(features, dtype=float)
    features[..., ATYPICAL_INDEX] = NEUTRAL_ATYPICAL_FRACTION
    return features


def test_feature_names_follow_the_dsp15_vector():
    assert len(FEATURE_NAMES) == FEATURES
    # The v1 vector keeps its slots, so ATYPICAL_INDEX and the logistic rule's columns don't move.
    assert (
        FEATURE_NAMES[0] == "normalizedRmssd"
        and FEATURE_NAMES[ATYPICAL_INDEX] == "atypicalFraction" == FEATURE_NAMES[7]
    )
    assert FEATURE_NAMES[8:] == (
        "medianAbsDiffNorm",
        "shortLongPairShare",
        "rmssdPairsRemovedNorm",
        "trimmedRmssdNorm",
        "largeChangeShare",
        "rrLag1Autocorr",
        "rrLag2Autocorr",
    )


def test_feature_names_are_cores_rhythm_feature_names():
    # The app refuses a rhythm model whose featureOrder isn't core's RHYTHM_FEATURE_NAMES (ADR 0079), and the
    # manifest's featureOrder is FEATURE_NAMES. core's feature-names.test.ts pins lumen_dsp's mirror to
    # core's list, so equality here makes the whole chain equal, not just a prefix.
    assert FEATURE_NAMES == RHYTHM_FEATURE_NAMES


def test_readings_are_90_second_blocks_with_their_bounding_beat_flags():
    intervals = np.full(300, 1000.0)
    premature = np.zeros(300, dtype=bool)
    premature[89] = True  # ends at 90 s, the last interval of the first reading
    readings = cut_readings(intervals, premature)
    assert [len(intervals) for intervals, _ in readings] == [89, 90, 90, 31]
    (first_intervals, first_beats), (_, second_beats) = readings[0], readings[1]
    assert len(first_beats) == len(first_intervals) + 1
    # Interval 89 ends exactly at 90 s, so it opens the second reading and its end beat is flagged.
    assert not first_beats.any()
    assert list(np.flatnonzero(second_beats)) == [1]


def test_window_inputs_follow_adr_0020_layout():
    intervals_s = np.linspace(0.6, 1.0, 40)
    window = rhythm_windows(intervals_s, [False] * 40, [False] * 41)[0]
    intervals, mask, features = window_inputs(window)
    assert intervals.shape == (INTERVALS,) and mask.shape == (INTERVALS,)
    np.testing.assert_allclose(intervals[:SIZE], intervals_s[:SIZE], rtol=1e-6)
    assert (intervals[SIZE:] == 0).all()
    assert (mask[:SIZE] == 1).all() and (mask[SIZE:] == 0).all()
    np.testing.assert_allclose(features, neutralized(dsp_features(window)), rtol=1e-6)


def test_dev_val_windows_match_lumen_dsp_on_the_raw_intervals():
    raw = irregular(70, 1)
    premature = [False] * 70
    premature[10] = True
    episodes = pd.DataFrame([episode("afdb", "01", "af", raw, premature)])
    windows = build_window_set(episodes, {"afdb:01": "dev-val"}, "dev-val", augment=False, seed=0, cap=400)
    expected = rhythm_windows(raw / 1000, [False] * 70, [False, *premature])
    assert len(windows.labels) == len(expected) == (70 - SIZE) // STEP + 1
    np.testing.assert_allclose(
        windows.features, neutralized([dsp_features(window) for window in expected]), rtol=1e-6
    )
    # The premature beat is in the first windows, so lumen_dsp's own value is not the constant.
    assert expected[0].atypical_fraction > 0
    assert set(windows.labels) == {LABELS.index("af")}
    assert set(windows.subjects) == {"afdb:01"}


def test_only_the_requested_split_is_used():
    episodes = pd.DataFrame(
        [episode("afdb", "01", "af", irregular(40, 1)), episode("afdb", "02", "sinus", np.full(40, 800))]
    )
    assignment = {"afdb:01": "dev-train", "afdb:02": "dev-val"}
    windows = build_window_set(episodes, assignment, "dev-val", augment=False, seed=0, cap=400)
    assert set(windows.subjects) == {"afdb:02"}


def test_a_subject_missing_from_the_split_file_is_an_error():
    episodes = pd.DataFrame([episode("afdb", "01", "af", irregular(40, 1))])
    with pytest.raises(KeyError, match="afdb:01"):
        build_window_set(episodes, {}, "dev-val", augment=False, seed=0, cap=400)


def test_cap_limits_windows_per_subject_and_label_and_is_seeded():
    # About 20 readings of about 6 windows each for one subject and label, plus one sinus window.
    episodes = pd.DataFrame(
        [
            episode("ltafdb", "01", "af", irregular(85 * 30, 2)),
            episode("ltafdb", "01", "sinus", np.full(40, 900)),
        ]
    )
    assignment = {"ltafdb:01": "dev-train"}
    first = build_window_set(episodes, assignment, "dev-train", augment=False, seed=3, cap=10)
    again = build_window_set(episodes, assignment, "dev-train", augment=False, seed=3, cap=10)
    other = build_window_set(episodes, assignment, "dev-train", augment=False, seed=4, cap=10)
    af = first.labels == LABELS.index("af")
    assert 0 < af.sum() <= 10
    assert (first.labels == LABELS.index("sinus")).sum() == 1
    np.testing.assert_array_equal(first.features, again.features)
    assert not np.array_equal(first.features, other.features)


def test_augmented_windows_stay_inside_the_dsp9_range(monkeypatch):
    # Force frequent splits so out-of-range pieces appear; those intervals must end a window run.
    real_augment = windows_module.augment_intervals

    def splitting_augment(intervals_ms, premature, rng, jitter_sd_ms):
        return real_augment(intervals_ms, premature, rng, jitter_sd_ms, split_rate=0.05)

    monkeypatch.setattr(windows_module, "augment_intervals", splitting_augment)
    episodes = pd.DataFrame([episode("afdb", "01", "sinus", np.full(85 * 20, 600.0))])
    windows = build_window_set(episodes, {"afdb:01": "dev-train"}, "dev-train", augment=True, seed=1, cap=400)
    real = windows.intervals[windows.mask > 0]
    assert len(windows.labels) > 0
    assert real.min() >= MIN_INTERVAL_S and real.max() <= MAX_INTERVAL_S


def test_augmentation_changes_intervals_and_draws_jitter_per_reading(monkeypatch):
    sigmas = []
    real_augment = windows_module.augment_intervals

    def recording_augment(intervals_ms, premature, rng, jitter_sd_ms):
        sigmas.append(jitter_sd_ms)
        return real_augment(intervals_ms, premature, rng, jitter_sd_ms)

    monkeypatch.setattr(windows_module, "augment_intervals", recording_augment)
    # 540 one-second intervals: six 90 s readings and a 1-interval remainder that has no window.
    episodes = pd.DataFrame([episode("afdb", "01", "sinus", np.full(540, 1000.0))])
    windows = build_window_set(episodes, {"afdb:01": "dev-train"}, "dev-train", augment=True, seed=1, cap=400)
    assert len(sigmas) == 6 and len(set(sigmas)) == 6
    low, high = windows_module.JITTER_SD_RANGE_MS
    assert all(low <= sigma <= high for sigma in sigmas)
    assert not np.allclose(windows.intervals[windows.mask > 0], 1.0)


def test_premature_only_keeps_readings_with_a_premature_beat():
    intervals = np.full(170, 1000.0)
    premature = [False] * 170
    # A 500 ms premature interval in the second reading (intervals 89-169) marks where windows came from.
    intervals[100] = 500.0
    premature[100] = True
    episodes = pd.DataFrame([episode("mitdb", "100", "other", intervals, premature)])
    windows = build_window_set(
        episodes, {"mitdb:100": "dev-val"}, "dev-val", augment=False, seed=0, cap=400, premature_only=True
    )
    assert len(set(windows.readings)) == 1
    assert len(windows.labels) == (81 - SIZE) // STEP + 1
    assert windows.intervals[0, :SIZE].min() == pytest.approx(0.5)


@pytest.mark.parametrize("augment", [False, True])
def test_atypical_fraction_has_zero_variance_in_training_matrices(augment):
    # ECG premature flags (about 0% in sinus) do not match the app's PPG DSP-9 atypical labels (31-42%
    # on BUT PPG sinus, Track C), so v1 models must not learn from this feature.
    premature = [index % 5 == 3 for index in range(400)]
    episodes = pd.DataFrame([episode("mitdb", "100", "other", np.full(400, 900.0), premature)])
    split = "dev-train" if augment else "dev-val"
    windows = build_window_set(episodes, {"mitdb:100": split}, split, augment=augment, seed=0, cap=400)
    column = windows.features[:, ATYPICAL_INDEX]
    assert FEATURE_NAMES[ATYPICAL_INDEX] == "atypicalFraction"
    assert column.var() == 0 and (column == NEUTRAL_ATYPICAL_FRACTION).all()


def test_window_set_round_trips_through_npz(tmp_path):
    episodes = pd.DataFrame([episode("afdb", "01", "af", irregular(70, 1))])
    windows = build_window_set(episodes, {"afdb:01": "dev-val"}, "dev-val", augment=False, seed=0, cap=400)
    path = tmp_path / "windows.npz"
    save_window_set(windows, path)
    loaded = load_window_set(path)
    for name in windows._fields:
        np.testing.assert_array_equal(getattr(loaded, name), getattr(windows, name))


def test_rsa_leaves_af_readings_alone():
    reading = windows_module.Reading("afdb:01", "af", np.full(120, 800.0), np.zeros(121, dtype=bool))
    for seed in range(20):
        np.testing.assert_array_equal(
            windows_module._with_rsa(reading, np.random.default_rng(seed)), reading.intervals_ms
        )


@pytest.mark.parametrize("label", ["sinus", "other"])
def test_rsa_modulates_non_af_readings_within_the_breathing_ranges(label):
    # ADR 0084: RR × (1 + A·sin(2π·f·t + φ)), A and f in range, on about RSA_PROBABILITY of readings.
    reading = windows_module.Reading("mitdb:100", label, np.full(120, 800.0), np.zeros(121, dtype=bool))
    low, high = windows_module.RSA_AMPLITUDE_RANGE
    changed = 0
    for seed in range(200):
        intervals = windows_module._with_rsa(reading, np.random.default_rng(seed))
        ratio = intervals / reading.intervals_ms
        if np.allclose(ratio, 1.0):
            continue
        changed += 1
        assert np.max(np.abs(ratio - 1.0)) <= high + 1e-12
        # 96 s of 0.8 s beats holds at least 14 breaths, so the swing reaches most of A.
        assert np.max(np.abs(ratio - 1.0)) >= 0.9 * low
    assert abs(changed / 200 - windows_module.RSA_PROBABILITY) < 0.1
