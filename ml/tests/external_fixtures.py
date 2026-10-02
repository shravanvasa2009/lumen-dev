import json
import sys
import zipfile
from pathlib import Path
from types import ModuleType, SimpleNamespace

import numpy as np
import onnx
import pandas as pd
import wfdb
from onnx import TensorProto, helper, numpy_helper
from scipy.signal import find_peaks

from datasets import download, registry
from datasets.vitaldb_cases import holdout_case_path, load_split
from export.provenance import sha256_of

FS = 125.0
SECONDS = 240.0
LAG_S = 0.25
THRESHOLDS = {"rhythm-lgbm": 0.5, "rhythm-net": 0.6, "sqi-finger": 0.5, "diabetes-net": 0.4}


def beat_times(irregular: bool, rng: np.random.Generator) -> np.ndarray:
    intervals = rng.uniform(0.5, 1.1, 600) if irregular else 0.8 + rng.normal(0, 0.01, 600)
    beats = 0.5 + np.cumsum(intervals)
    return beats[beats < SECONDS - 1]


def synthetic_signals(irregular: bool, seed: int) -> tuple[np.ndarray, np.ndarray]:
    # ECG: a narrow QRS with a T wave; PPG: one smooth pulse per beat, LAG_S after its R-peak.
    rng = np.random.default_rng(seed)
    t = np.arange(int(SECONDS * FS)) / FS
    ecg, ppg = np.zeros_like(t), np.zeros_like(t)
    for beat in beat_times(irregular, rng):
        ecg += np.exp(-0.5 * ((t - beat) / 0.012) ** 2) + 0.2 * np.exp(-0.5 * ((t - beat - 0.25) / 0.05) ** 2)
        ppg += np.exp(-0.5 * ((t - beat - LAG_S) / 0.1) ** 2)
    return ppg + rng.normal(0, 0.01, len(t)), ecg + rng.normal(0, 0.01, len(t))


def write_mimic(dataset_dir: Path, af_subjects: int = 2, non_af_subjects: int = 2) -> None:
    dataset_dir.mkdir(parents=True, exist_ok=True)
    for archive, prefix, count, irregular in (
        ("mimic_perform_af_wfdb.zip", "mimic_perform_af", af_subjects, True),
        ("mimic_perform_non_af_wfdb.zip", "mimic_perform_non_af", non_af_subjects, False),
    ):
        staging = dataset_dir / f"staging-{prefix}"
        staging.mkdir()
        for index in range(count):
            ppg, ecg = synthetic_signals(irregular, seed=index + (100 if irregular else 0))
            wfdb.wrsamp(
                f"{prefix}_{index + 1:03d}_data",
                fs=FS,
                units=["mV", "NU"],
                sig_name=["II", "PLETH"],
                p_signal=np.column_stack([ecg, ppg]),
                fmt=["16", "16"],
                write_dir=str(staging),
            )
        with zipfile.ZipFile(dataset_dir / archive, "w") as bundle:
            for file in sorted(staging.iterdir()):
                bundle.write(file, f"{prefix}/{file.name}")
    (dataset_dir / download.MARKER_NAME).write_text("{}", encoding="utf-8")


def fake_beat_modules() -> dict[str, ModuleType]:
    # Stands in for Track C's DSP-7/9 Python mirror on these clean pulses: one beat per pulse peak.
    beats, classes = ModuleType("lumen_dsp.beats"), ModuleType("lumen_dsp.beat_classes")

    def detect_beats(model, shape):
        rate = 256.0
        peaks, _ = find_peaks(shape.values, distance=int(0.3 * rate), prominence=0.3 * np.std(shape.values))
        return [
            SimpleNamespace(
                peak_s=(shape.first_index + peak) / rate, onset_s=None, max_upslope=1.0, amplitude=1.0
            )
            for peak in peaks
        ]

    def classify_beats(detected, shape, rejected_spans):
        assert rejected_spans == []
        return [
            SimpleNamespace(peak_s=beat.peak_s, onset_s=None, beat_class="normal", long_pause=False)
            for beat in detected
        ]

    beats.detect_beats, classes.classify_beats = detect_beats, classify_beats
    return {"lumen_dsp.beats": beats, "lumen_dsp.beat_classes": classes}


def install_fake_beats(monkeypatch) -> None:
    for name, module in fake_beat_modules().items():
        monkeypatch.setitem(sys.modules, name, module)


def _save(nodes, inputs, output, initializers, path: Path) -> None:
    graph = helper.make_graph(nodes, path.stem, inputs, [output], initializer=initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    path.write_bytes(model.SerializeToString())


def _rhythm_model(path: Path, with_sequence: bool) -> None:
    # P(AF) rises with normalized RMSSD (feature 0): softmax over [sinus, af, other].
    weights = np.zeros((8, 3), dtype=np.float32)
    weights[0, 1] = 20.0
    bias = np.array([0.0, -2.0, -5.0], dtype=np.float32)
    inputs = [helper.make_tensor_value_info("features", TensorProto.FLOAT, [None, 8])]
    if with_sequence:
        inputs = [
            helper.make_tensor_value_info("intervals", TensorProto.FLOAT, [None, 64]),
            helper.make_tensor_value_info("mask", TensorProto.FLOAT, [None, 64]),
            *inputs,
        ]
    _save(
        [
            helper.make_node("MatMul", ["features", "weights"], ["logits_raw"]),
            helper.make_node("Add", ["logits_raw", "bias"], ["logits"]),
            helper.make_node("Softmax", ["logits"], ["probs"], axis=1),
        ],
        inputs,
        helper.make_tensor_value_info("probs", TensorProto.FLOAT, [None, 3]),
        [numpy_helper.from_array(weights, "weights"), numpy_helper.from_array(bias, "bias")],
        path,
    )


def _sqi_model(path: Path) -> None:
    _save(
        [
            helper.make_node("ReduceMax", ["window"], ["peak"], axes=[2], keepdims=0),
            helper.make_node("Sigmoid", ["peak"], ["pClean"]),
        ],
        [helper.make_tensor_value_info("window", TensorProto.FLOAT, [None, 1, 256])],
        helper.make_tensor_value_info("pClean", TensorProto.FLOAT, [None, 1]),
        [],
        path,
    )


def write_models(models_dir: Path) -> dict:
    models_dir.mkdir(parents=True, exist_ok=True)
    _rhythm_model(models_dir / "rhythm-lgbm@1.0.0.onnx", with_sequence=False)
    _rhythm_model(models_dir / "rhythm-net@1.0.0.onnx", with_sequence=True)
    _sqi_model(models_dir / "sqi-finger@1.0.0.onnx")
    # The diabetes part reads precomputed scores; only the file's sha256 is checked here.
    _sqi_model(models_dir / "diabetes-net@1.0.0.onnx")
    rows = [
        ("rhythm-lgbm", "rhythm", True, {"features": [1, 8]}, "af", 0.6, "mimic-perform-af"),
        (
            "rhythm-net",
            "rhythm",
            False,
            {"intervals": [1, 64], "mask": [1, 64], "features": [1, 8]},
            "af",
            0.6,
            "mimic-perform-af",
        ),
        ("sqi-finger", "sqi", True, {"window": [1, 1, 256]}, "clean", None, "mimic-perform-af"),
        ("diabetes-net", "diabetes", True, {"beat": [1, 1, 256]}, "pattern", None, "vitaldb-holdout"),
    ]
    entries = [
        {
            "name": name,
            "family": family,
            "ships": ships,
            "version": "1.0.0",
            "file": f"{name}@1.0.0.onnx",
            "sha256": sha256_of(models_dir / f"{name}@1.0.0.onnx"),
            "inputs": inputs,
            "labels": ["sinus", "af", "other"] if family == "rhythm" else [key],
            "threshold": {key: THRESHOLDS[name]},
            "abstainBelow": abstain,
            "externalTest": {"dataset": dataset},
        }
        for name, family, ships, inputs, key, abstain, dataset in rows
    ]
    manifest = {"models": entries}
    (models_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


WITHOUT_PLETH = 3


def holdout_scores(holdout: list[int]) -> dict:
    # Every holdout patient but the last WITHOUT_PLETH, as ADR 0014's amendment allows.
    rng = np.random.default_rng(5)
    scored = holdout[: len(holdout) - WITHOUT_PLETH]
    rows = []
    for index, subject in enumerate(scored):
        diabetic = index % 3 == 0
        score = float(np.clip(rng.normal(0.6 if diabetic else 0.3, 0.1), 0, 1))
        rows.append({"subject": subject, "diabetic": diabetic, "score": score})
    return {"subjects": rows, "holdoutWithoutPleth": WITHOUT_PLETH}


def install_fake_scorer(monkeypatch, edit=None) -> list[tuple]:
    # Stands in for track/ml-diabetes's holdout scorer; records each call so tests can see when it ran.
    calls: list[tuple] = []
    module = ModuleType("train.diabetes_holdout")

    def score_holdout(entry, models_dir, holdout):
        calls.append((entry["name"], len(holdout)))
        scored = {**holdout_scores(holdout), "onnxSha256": entry["sha256"]}
        return edit(scored) if edit else scored

    module.score_holdout = score_holdout
    monkeypatch.setitem(sys.modules, "train.diabetes_holdout", module)
    return calls


def write_holdout_files() -> None:
    # The open VitalDB clinical table (one eligible case per holdout patient) and an empty .vital file per
    # holdout case, under the test's LUMEN_DATA_DIR; preflight checks only that each file is there.
    holdout = load_split()["holdout"]
    vitaldb = next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb")
    vitaldb.local_dir.mkdir(parents=True, exist_ok=True)
    clinical = pd.DataFrame(
        {
            "caseid": range(1, len(holdout) + 1),
            "subjectid": holdout,
            "age": "60",
            "sex": "F",
            "preop_dm": [index % 3 == 0 for index in range(len(holdout))],
        }
    ).astype({"preop_dm": int})
    clinical.to_csv(vitaldb.local_dir / "clinical_data.csv", index=False)
    download.write_marker(vitaldb)
    for caseid in clinical["caseid"]:
        path = holdout_case_path(int(caseid))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
