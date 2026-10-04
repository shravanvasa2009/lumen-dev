import json
import math

import numpy as np
import pandas as pd
import pytest
from sklearn.dummy import DummyClassifier

from export.provenance import ProvenanceError
from export.specs import SPECS
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.shape_features import SHAPE_FEATURE_NAMES, shape_features
from nets.diabetes_net import HR_SUMMARY_NAMES
from nets.rhythm_net import FEATURES
from tests.test_train_diabetes import write_inputs
from tests.test_vitaldb_pleth import write_vital
from tests.training_artifacts import fit_baseline, save_trained
from train import diabetes_features, vitaldb_pleth
from train.diabetes import TABLE_COLUMNS, load_feature_table
from train.diabetes_features import (
    ABSTAINED,
    NO_RHYTHM_CARD,
    coverage,
    extract_case_features,
    feature_table,
    ShippedRhythm,
    load_rhythm_model,
    segment_features,
    segment_table,
)
from train.vitaldb_pleth import PLETH_RATE_HZ, SEGMENT_S, extract_case


def constant_model(sinus: int, af: int, other: int, sha: str) -> ShippedRhythm:
    # A real classifier whose window probabilities are the class shares it was fitted on, whatever the
    # features, so a test picks the reading's rhythm label.
    labels = [0] * sinus + [1] * af + [2] * other
    classifier = DummyClassifier(strategy="prior").fit(np.zeros((len(labels), FEATURES)), labels)
    return ShippedRhythm(classifier, sha, DSP_CONFIG["rules"]["uncertainBelowTopProb"])


SINUS = constant_model(90, 5, 5, "sinus-model")
AF = constant_model(5, 90, 5, "af-model")
# 1/3 per class, under the 0.6 abstain line.
UNDECIDED = constant_model(1, 1, 1, "undecided-model")


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


def test_a_clean_sinus_segment_gives_an_averaged_beat_its_shape_features_and_hrv():
    row, pulse_shape = segment_features(bands_of(finger_pulse_codes(SEGMENT_S)), SINUS)
    assert row["hasShape"] and pulse_shape is not None
    assert pulse_shape.beat.shape == (DSP_CONFIG["dsp14"]["beatSamples"],)
    assert row["beatsUsed"] == pulse_shape.beats_used >= DSP_CONFIG["dsp14"]["minNormalBeats"]
    assert [row[name] for name in SHAPE_FEATURE_NAMES] == shape_features(pulse_shape)
    assert row["rhythm"] == "sinus"
    assert row["hrBpm"] == pytest.approx(70, abs=2)
    assert row["beats_normal"] >= 95
    assert row["rmssdMs"] > 0 and 0 <= row["pnn50"] <= 1
    # DSP-12's SDNN needs 300 clean seconds; a 90 s Full Scan never has it, in the app or here.
    assert row["sdnnMs"] is None


@pytest.mark.parametrize(("model", "label"), [(AF, "af"), (UNDECIDED, ABSTAINED)])
def test_hrv_is_null_unless_the_reading_is_confidently_sinus(model, label):
    row, _ = segment_features(bands_of(finger_pulse_codes(SEGMENT_S)), model)
    assert row["rhythm"] == label
    assert row["hrBpm"] == pytest.approx(70, abs=2)
    assert [row["rmssdMs"], row["sdnnMs"], row["pnn50"]] == [None, None, None]


def test_too_few_beats_give_no_averaged_beat_and_no_rhythm_card_but_still_a_row():
    # 15 s at 70 bpm holds about 17 beats, fewer than DSP-14's 20 and DSP-15's 40 usable intervals.
    row, pulse_shape = segment_features(bands_of(finger_pulse_codes(15)), SINUS)
    assert pulse_shape is None and not row["hasShape"] and row["beatsUsed"] == 0
    assert row["beats_normal"] < DSP_CONFIG["dsp14"]["minNormalBeats"]
    assert all(row[name] is None for name in SHAPE_FEATURE_NAMES)
    assert row["rhythm"] == NO_RHYTHM_CARD and row["rmssdMs"] is None
    assert row["hrBpm"] == pytest.approx(70, abs=2)


def test_noise_without_a_pulse_gives_no_averaged_beat():
    rng = np.random.default_rng(3)
    noise = np.round(400 + 30 * rng.standard_normal(SEGMENT_S * PLETH_RATE_HZ)).astype(np.int16)
    row, pulse_shape = segment_features(bands_of(noise), SINUS)
    assert pulse_shape is None
    # The noise reaches the rhythm step (DSP-7 keeps peaks in time order, ADR 0068) without enough
    # usable intervals for a rhythm card.
    assert row["rhythm"] == NO_RHYTHM_CARD


def test_the_rhythm_model_is_the_shipped_one_from_its_trained_files(tmp_path):
    spec = SPECS["rhythm-lgbm"]
    assert spec.ships
    metrics = save_trained(spec, tmp_path, fit_baseline(spec))
    model = load_rhythm_model(tmp_path)
    assert model.source_sha256 == metrics["sourceSha256"]
    assert model.abstain_below == spec.abstain_below == DSP_CONFIG["rules"]["uncertainBelowTopProb"]
    (tmp_path / spec.source_file).write_bytes(b"not the trained pickle")
    with pytest.raises(ProvenanceError, match="sha256"):
        load_rhythm_model(tmp_path)
    with pytest.raises(FileNotFoundError):
        load_rhythm_model(tmp_path / "empty")


def pleth_case(tmp_path, caseid: int, codes: np.ndarray | None):
    vital = tmp_path / f"{caseid:04d}.vital"
    write_vital(vital, codes)
    extract_case(caseid, caseid * 10, vital, tmp_path / "pleth")


def test_case_features_are_cached_and_resumed(tmp_path, monkeypatch):
    pleth_case(tmp_path, 7, finger_pulse_codes(SEGMENT_S * 2 + 5))
    status = extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features", SINUS)
    assert [segment["segment"] for segment in status["segments"]] == [0, 1]
    assert [segment["startS"] for segment in status["segments"]] == [0.0, SEGMENT_S]
    shapes = np.load(tmp_path / "features" / "shapes" / "0007.npz")
    assert shapes["beat"].shape == (2, DSP_CONFIG["dsp14"]["beatSamples"])
    assert shapes["waves"].shape == (2, 5) and shapes["waves"][0, 0] >= 0

    def fail(bands, model):
        raise AssertionError("a cached case was recomputed")

    monkeypatch.setattr(diabetes_features, "segment_features", fail)
    assert extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features", SINUS) == status


def test_case_features_are_redone_when_settings_or_the_rhythm_model_change(tmp_path, monkeypatch):
    pleth_case(tmp_path, 7, finger_pulse_codes(SEGMENT_S + 5))
    first = extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features", SINUS)
    assert first["segments"][0]["rhythm"] == "sinus"
    redone = extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features", AF)
    assert redone["segments"][0]["rhythm"] == "af"
    assert redone["params"]["rhythmModel"]["sourceSha256"] == "af-model"
    params = diabetes_features.cache_params(AF) | {"code": {"lumen_dsp/shape_features.py": "edited"}}
    monkeypatch.setattr(diabetes_features, "cache_params", lambda model: params)
    again = extract_case_features(7, 70, tmp_path / "pleth", tmp_path / "features", AF)
    assert again["params"]["code"] == {"lumen_dsp/shape_features.py": "edited"}


def test_the_cache_key_covers_the_feature_code(tmp_path, monkeypatch):
    package = tmp_path / "lumen_dsp"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    source = package / "shape_features.py"
    source.write_text("WIDTH = 0.5\n", encoding="utf-8")
    config = package / "dsp_config.json"
    config.write_text('{"liveHr": {"minBpm": 40}}', encoding="utf-8")
    monkeypatch.setattr(diabetes_features.lumen_dsp, "__file__", str(package / "__init__.py"))
    before = diabetes_features.code_sha256()
    assert "lumen_dsp/shape_features.py" in before
    assert any(name.endswith("external_mimic.py") for name in before)
    assert any(name.endswith("vitaldb_pleth.py") for name in before)
    source.write_text("WIDTH = 0.25\n", encoding="utf-8")
    after = diabetes_features.code_sha256()
    assert after["lumen_dsp/shape_features.py"] != before["lumen_dsp/shape_features.py"]
    # vitaldb_pleth picks segments with dsp_config.json's liveHr range, which no other key holds.
    config.write_text('{"liveHr": {"minBpm": 35}}', encoding="utf-8")
    edited = diabetes_features.code_sha256()
    assert edited["lumen_dsp/dsp_config.json"] != after["lumen_dsp/dsp_config.json"]
    assert diabetes_features.cache_params(AF)["code"] == edited


def test_case_without_segments_and_missing_pleth_status(tmp_path):
    pleth_case(tmp_path, 8, None)
    status = extract_case_features(8, 80, tmp_path / "pleth", tmp_path / "features", SINUS)
    assert status["segments"] == []
    assert not (tmp_path / "features" / "shapes" / "0008.npz").exists()
    with pytest.raises(FileNotFoundError):
        extract_case_features(9, 90, tmp_path / "pleth", tmp_path / "features", SINUS)


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
        extract_case_features(caseid, caseid * 10, tmp_path / "pleth", tmp_path / "features", SINUS)

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
    assert (train["segmentsTheAppRefuses"], train["segmentsForTraining"]) == (0, 2)
    assert (train["diabeticCasesForTraining"], train["controlCasesForTraining"]) == (1, 0)
    assert train["rhythmOfTrainingSegments"] == {"sinus": 2}
    assert train["trainingSegmentsWithValue"]["sdnnMs"] == 0
    assert train["trainingSegmentsWithValue"]["hrBpm"] == 2
    assert report["dev-val"]["cases"] == 1 and report["dev-val"]["segments"] == 0
    assert json.loads(json.dumps(report)) == report


def test_feature_table_keeps_segments_with_a_beat_in_the_training_schema(tmp_path):
    pleth_case(tmp_path, 1, finger_pulse_codes(SEGMENT_S * 2 + 5))
    pleth_case(tmp_path, 2, finger_pulse_codes(SEGMENT_S + 5))
    stored = dict(np.load(tmp_path / "pleth" / "segments" / "0002.npz"))
    noise = 400 + 30 * np.random.default_rng(4).standard_normal(stored["codes"].shape)
    stored["codes"] = np.round(noise).astype(np.int16)
    np.savez_compressed(tmp_path / "pleth" / "segments" / "0002.npz", **stored)
    for caseid in (1, 2):
        extract_case_features(caseid, caseid * 10, tmp_path / "pleth", tmp_path / "features", SINUS)
    cases = pd.DataFrame({"caseid": [1, 2], "subjectid": [10, 20], "preop_dm": [1, 0]})
    dev_split = {10: "dev-train", 20: "dev-val"}

    table = feature_table(segment_table(tmp_path / "features", cases, dev_split))
    assert list(table.columns) == list(TABLE_COLUMNS)
    assert list(table["subject"]) == [10, 10] and list(table["label"]) == [True, True]
    assert table["label"].dtype == bool and list(table["split"]) == ["dev-train", "dev-train"]
    assert all(len(beat) == DSP_CONFIG["dsp14"]["beatSamples"] for beat in table["beat"])
    # SDNN arrives as NaN for the trainer to fill; HR is always there on a clean 90 s segment.
    assert table["sdnnMs"].isna().all() and table["hrBpm"].notna().all()
    assert set(HR_SUMMARY_NAMES) <= set(table.columns)

    features, holdout, dev = write_inputs(tmp_path / "inputs", table)
    loaded = load_feature_table(features, holdout, dev)
    assert len(loaded) == 2 and not any(math.isinf(value) for value in loaded["riseTime"])
