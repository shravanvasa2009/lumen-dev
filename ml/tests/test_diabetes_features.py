import json

import numpy as np
import pandas as pd
import pytest

from lumen_dsp.config import DSP_CONFIG
from tests.test_vitaldb_pleth import write_vital
from train import diabetes_features, vitaldb_pleth
from train.diabetes_features import coverage, extract_case_features, segment_features, segment_table
from train.vitaldb_pleth import PLETH_RATE_HZ, SEGMENT_S, extract_case


def finger_pulse_codes(seconds: float, bpm: float = 70.0, seed: int = 1) -> np.ndarray:
    # A clinical pleth pulse: fast systolic rise, exponential diastolic runoff (so the signal is never
    # flat, like VitalDB's), a dicrotic wave 0.3 s later, ±3% RR jitter, and 10% breathing modulation,
    # as int16 ADC codes like SNUADC/PLETH.
    rng = np.random.default_rng(seed)
    t_s = np.arange(round(seconds * PLETH_RATE_HZ)) / PLETH_RATE_HZ
    intervals = 60 / bpm * (1 + 0.03 * rng.standard_normal(int(seconds * bpm / 60) + 8))
    wave = np.zeros_like(t_s)
    # Beats start before the window, as in the middle of a recording.
    for peak_s in np.cumsum(intervals) - 2:
        dt = t_s - peak_s
        wave += np.where(dt < 0, np.exp(-0.5 * (dt / 0.05) ** 2), np.exp(-np.maximum(dt, 0) / 0.4))
        wave += 0.35 * np.exp(-0.5 * ((dt - 0.3) / 0.07) ** 2)
    breathing = 1 + 0.1 * np.sin(2 * np.pi * 0.25 * t_s)
    return np.round(400 + 60 * wave * breathing).astype(np.int16)


def bands_of(codes: np.ndarray, start_s: float = 0.0) -> vitaldb_pleth.SegmentBands:
    dsp2 = DSP_CONFIG["dsp2"]
    return vitaldb_pleth.SegmentBands(
        start_s=start_s,
        model=vitaldb_pleth.morphology_band(codes, 1.0, 0.0, dsp2["modelRateHz"]),
        shape=vitaldb_pleth.morphology_band(codes, 1.0, 0.0, dsp2["shapeRateHz"]),
    )


def test_a_clean_segment_gives_an_averaged_beat_and_an_hr_summary():
    row, pulse_shape = segment_features(bands_of(finger_pulse_codes(SEGMENT_S)))
    assert row["hasShape"] and pulse_shape is not None
    assert pulse_shape.beat.shape == (DSP_CONFIG["dsp14"]["beatSamples"],)
    assert row["beatsUsed"] == pulse_shape.beats_used >= DSP_CONFIG["dsp14"]["minNormalBeats"]
    assert row["hrBpm"] == pytest.approx(70, abs=2)
    assert row["beats_normal"] >= 95
    assert row["rmssdMs"] > 0 and row["sdnnMs"] > 0 and 0 <= row["pnn50"] <= 1


def test_too_few_beats_give_no_averaged_beat_but_still_a_row():
    # 15 s at 70 bpm holds about 17 beats, fewer than DSP-14's 20.
    row, pulse_shape = segment_features(bands_of(finger_pulse_codes(15)))
    assert pulse_shape is None and not row["hasShape"] and row["beatsUsed"] == 0
    assert row["beats_normal"] < DSP_CONFIG["dsp14"]["minNormalBeats"]
    assert row["hrBpm"] == pytest.approx(70, abs=2)


def test_noise_without_a_pulse_gives_no_averaged_beat():
    rng = np.random.default_rng(3)
    noise = np.round(400 + 30 * rng.standard_normal(SEGMENT_S * PLETH_RATE_HZ)).astype(np.int16)
    _, pulse_shape = segment_features(bands_of(noise))
    assert pulse_shape is None


def pleth_case(tmp_path, caseid: int, codes: np.ndarray | None):
    vital = tmp_path / f"{caseid:04d}.vital"
    write_vital(vital, codes)
    extract_case(caseid, caseid * 10, vital, tmp_path / "pleth")


def test_case_features_are_cached_and_resumed(tmp_path, monkeypatch):
    pleth_case(tmp_path, 7, finger_pulse_codes(SEGMENT_S * 2 + 5))
    status = extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features")
    assert [segment["segment"] for segment in status["segments"]] == [0, 1]
    assert [segment["startS"] for segment in status["segments"]] == [0.0, SEGMENT_S]
    shapes = np.load(tmp_path / "features" / "shapes" / "0007.npz")
    assert shapes["beat"].shape == (2, DSP_CONFIG["dsp14"]["beatSamples"])
    assert shapes["waves"].shape == (2, 5) and shapes["waves"][0, 0] >= 0

    def fail(bands):
        raise AssertionError("a cached case was recomputed")

    monkeypatch.setattr(diabetes_features, "segment_features", fail)
    assert extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features") == status


def test_case_features_are_redone_when_settings_change(tmp_path, monkeypatch):
    pleth_case(tmp_path, 7, finger_pulse_codes(SEGMENT_S + 5))
    extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features")
    params = diabetes_features.cache_params() | {"hrSummary": "lumen_dsp.metrics"}
    monkeypatch.setattr(diabetes_features, "cache_params", lambda: params)
    redone = extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features")
    assert redone["params"]["hrSummary"] == "lumen_dsp.metrics"


def test_case_without_segments_and_missing_pleth_status(tmp_path):
    pleth_case(tmp_path, 8, None)
    status = extract_case_features(8, 80, tmp_path / "pleth", tmp_path / "features")
    assert status["segments"] == []
    assert not (tmp_path / "features" / "shapes" / "0008.npz").exists()
    with pytest.raises(FileNotFoundError):
        extract_case_features(9, 90, tmp_path / "pleth", tmp_path / "features")


def test_table_carries_patient_labels_and_splits_and_coverage_counts_them(tmp_path):
    pleth_case(tmp_path, 1, finger_pulse_codes(SEGMENT_S * 2 + 5))
    # The second case's only segment is replaced by noise after extraction, so it has no averaged beat.
    pleth_case(tmp_path, 2, finger_pulse_codes(SEGMENT_S + 5))
    stored = dict(np.load(tmp_path / "pleth" / "segments" / "0002.npz"))
    noise = 400 + 30 * np.random.default_rng(4).standard_normal(stored["codes"].shape)
    stored["codes"] = np.round(noise).astype(np.int16)
    np.savez_compressed(tmp_path / "pleth" / "segments" / "0002.npz", **stored)
    pleth_case(tmp_path, 3, None)
    for caseid in (1, 2, 3):
        extract_case_features(caseid, caseid * 10, tmp_path / "pleth", tmp_path / "features")

    cases = pd.DataFrame({"caseid": [1, 2, 3], "subjectid": [10, 20, 30], "preop_dm": [1, 0, 0]})
    dev_split = {10: "dev-train", 20: "dev-train", 30: "dev-val"}
    table = segment_table(tmp_path / "features", cases, dev_split)
    assert list(table["caseid"]) == [1, 1, 2]
    assert list(table["preop_dm"]) == [1, 1, 0] and set(table["split"]) == {"dev-train"}
    assert table["beat"].iloc[0] is not None and len(table["beat"].iloc[0]) == 256
    assert table["beat"].iloc[2] is None

    report = coverage(cases, table, dev_split)
    train = report["dev-train"]
    assert (train["cases"], train["casesWithSegments"], train["segments"]) == (2, 2, 3)
    assert (train["segmentsWithShape"], train["segmentsWithoutShape"]) == (2, 1)
    assert (train["diabeticCasesWithShape"], train["controlCasesWithShape"]) == (1, 0)
    assert report["dev-val"]["cases"] == 1 and report["dev-val"]["segments"] == 0
    assert json.loads(json.dumps(report)) == report
