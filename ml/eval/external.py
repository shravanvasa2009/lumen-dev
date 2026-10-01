import argparse
import json
import logging
import math
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pandas as pd

from datasets import download, registry
from datasets.vitaldb_cases import SPLIT_FILE, load_split
from eval.external_gate import (
    APPROVAL_FILE,
    RESULTS_FILE,
    ExternalTestRefusedError,
    check_gate,
    finish_runs,
    read_approval,
    read_results,
    start_runs,
    write_results,
)
from eval.external_mimic import (
    EXPECTED_SUBJECTS,
    ChannelError,
    RecordingAnalysis,
    analyse,
    beat_modules,
    load_recording,
    record_paths,
)
from eval.external_stats import (
    DIABETES_FLOOR,
    DIABETES_PREVALENCES,
    RHYTHM_FLOOR,
    RHYTHM_PREVALENCES,
    RHYTHM_TARGET_AUROC,
    BiasWindows,
    binary_report,
    floor_met,
    rhythm_bias_report,
    rhythm_outcome,
)
from export.provenance import sha256_of
from export.specs import MODELS_DIR
from export.write_manifest import git_commit
from train.rhythm import Units, with_ci
from train.rhythm_windows import window_inputs

PARTS = ("rhythm", "sqi", "diabetes")
# The threshold each family's decision uses, as the manifest and model card freeze it.
THRESHOLD_KEYS = {"rhythm": "af", "sqi": "clean", "diabetes": "pattern"}
# The order train.rhythm_windows.window_inputs returns them in (ADR 0020).
RHYTHM_INPUTS = ("intervals", "mask", "features")
MIMIC = next(dataset for dataset in registry.DATASETS if dataset.key == "mimic-perform-af")

log = logging.getLogger("eval.external")


def model_id(entry: dict) -> str:
    return f"{entry['name']}@{entry['version']}"


def frozen_threshold(entry: dict, family: str) -> float:
    # The external run never chooses a threshold: a model without its frozen one is refused.
    threshold = (entry.get("threshold") or {}).get(THRESHOLD_KEYS[family])
    if not (
        isinstance(threshold, int | float) and not isinstance(threshold, bool) and math.isfinite(threshold)
    ):
        raise ExternalTestRefusedError(f"{model_id(entry)} has no frozen {THRESHOLD_KEYS[family]} threshold")
    return float(threshold)


def family_entries(models_dir: Path, family: str) -> list[dict]:
    path = models_dir / "manifest.json"
    if not path.is_file():
        raise ExternalTestRefusedError(f"{path} not found; export and write the manifest first")
    entries = [
        entry for entry in json.loads(path.read_text(encoding="utf-8"))["models"] if entry["family"] == family
    ]
    if sum(1 for entry in entries if entry["ships"]) != 1:
        raise ExternalTestRefusedError(f"the manifest needs exactly one shipped {family} model (ADR 0031)")
    for entry in entries:
        file = models_dir / entry["file"]
        if not file.is_file() or sha256_of(file) != entry["sha256"]:
            raise ExternalTestRefusedError(f"{file} is missing or does not match the manifest's sha256")
        frozen_threshold(entry, family)
    return entries


def onnx_output(path: Path, inputs: dict[str, np.ndarray]) -> np.ndarray:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    (output,) = session.run(None, inputs)
    return np.asarray(output, dtype=np.float64)


def _grouped(scores: np.ndarray, is_af: np.ndarray, subjects: np.ndarray, keys: np.ndarray) -> Units:
    frame = pd.DataFrame({"score": scores, "is_af": is_af, "subject": subjects, "key": keys})
    grouped = frame.groupby("key", sort=True).agg(
        score=("score", "mean"), is_af=("is_af", "first"), subject=("subject", "first")
    )
    return Units(
        grouped["score"].to_numpy(), grouped["is_af"].to_numpy(bool), grouped["subject"].to_numpy(str)
    )


def rhythm_part(entries: list[dict], analyses: list[RecordingAnalysis], models_dir: Path) -> dict:
    rows = [
        (analysis.subject, analysis.is_af, f"{analysis.subject}#{reading}", window_inputs(window))
        for analysis in analyses
        for reading, window in analysis.rhythm
    ]
    if not rows:
        raise ValueError("no subject produced a DSP-15 window")
    subjects = np.asarray([row[0] for row in rows], dtype=str)
    is_af = np.asarray([row[1] for row in rows], dtype=bool)
    readings = np.asarray([row[2] for row in rows], dtype=str)
    batch = {
        name: np.stack([row[3][position] for row in rows]).astype(np.float32)
        for position, name in enumerate(RHYTHM_INPUTS)
    }
    reports, shipped = {}, None
    for entry in entries:
        tau = frozen_threshold(entry, "rhythm")
        probs = onnx_output(models_dir / entry["file"], {name: batch[name] for name in entry["inputs"]})
        scores = probs[:, entry["labels"].index("af")]
        subject_report = binary_report(_grouped(scores, is_af, subjects, subjects), tau, RHYTHM_PREVALENCES)
        # §11.11 and ADR 0041: a reading's probabilities are the mean over its windows; it abstains when
        # the top one is below abstainBelow.
        reading_probs = pd.DataFrame(probs).groupby(readings, sort=True).mean().to_numpy()
        reading_units = _grouped(scores, is_af, subjects, readings)
        abstain = with_ci(
            Units(reading_probs.max(axis=1), reading_units.is_af, reading_units.subjects),
            lambda _is_af, top, below=entry["abstainBelow"]: float(np.mean(top < below)),
        )
        reports[entry["name"]] = {
            "model": model_id(entry),
            "ships": entry["ships"],
            "subject": subject_report,
            "reading": binary_report(reading_units, tau, ()),
            "window": binary_report(Units(scores, is_af, subjects), tau, ()),
            "readingAbstainRate": abstain,
            "floorMet": floor_met(subject_report, RHYTHM_FLOOR),
            "targetAurocMet": floor_met(subject_report, {"auroc": RHYTHM_TARGET_AUROC}),
        }
        if entry["ships"]:
            shipped = entry["name"]
    headline = reports[shipped]
    scored = {analysis.subject: analysis.is_af for analysis in analyses if analysis.rhythm}
    return {
        "model": headline["model"],
        "dataset": MIMIC.key,
        "subjects": len(scored),
        "afSubjects": sum(scored.values()),
        "nonAfSubjects": len(scored) - sum(scored.values()),
        "subjectsWithoutWindows": sorted(analysis.subject for analysis in analyses if not analysis.rhythm),
        **{
            field: headline["subject"][field]
            for field in ("threshold", "auroc", "sensitivity", "specificity")
        },
        "ci95": headline["subject"]["ci95"],
        "ppvNpv": headline["subject"]["ppvNpv"],
        "floor": RHYTHM_FLOOR,
        "floorMet": headline["floorMet"],
        "targetAuroc": RHYTHM_TARGET_AUROC,
        "targetAurocMet": headline["targetAurocMet"],
        **rhythm_outcome({name: report["subject"] for name, report in reports.items()}, shipped),
        "models": reports,
    }


def sqi_part(entry: dict, analyses: list[RecordingAnalysis], models_dir: Path) -> dict:
    tau = frozen_threshold(entry, "sqi")
    subjects, is_af, accepted, hr_bpm, flat = [], [], [], [], {"af": 0, "nonAf": 0}
    for analysis in analyses:
        scorable = [model_input is not None for model_input in analysis.sqi_inputs]
        p_clean = np.full(len(scorable), np.nan)
        if any(scorable):
            windows = np.stack(
                [model_input for model_input in analysis.sqi_inputs if model_input is not None]
            )
            p_clean[np.asarray(scorable)] = onnx_output(
                models_dir / entry["file"], {"window": windows[:, np.newaxis, :].astype(np.float32)}
            )[:, 0]
        flat["af" if analysis.is_af else "nonAf"] += scorable.count(False)
        # ADR 0028: a flat window is not accepted and never reference-clean.
        keep = analysis.reference_clean & np.asarray(scorable, dtype=bool)
        subjects += [analysis.subject] * int(keep.sum())
        is_af += [analysis.is_af] * int(keep.sum())
        accepted += (p_clean[keep] >= tau).tolist()
        hr_bpm += analysis.hr_bpm[keep].tolist()
    windows = BiasWindows(
        np.asarray(subjects, dtype=str),
        np.asarray(is_af, dtype=bool),
        np.asarray(accepted, dtype=bool),
        np.asarray(hr_bpm),
    )
    af_subjects = [analysis.subject for analysis in analyses if analysis.is_af]
    non_af_subjects = [analysis.subject for analysis in analyses if not analysis.is_af]
    return {
        "model": model_id(entry),
        "role": entry.get("role"),
        "dataset": MIMIC.key,
        "threshold": tau,
        "subjects": len(analyses),
        "afSubjects": len(af_subjects),
        "nonAfSubjects": len(non_af_subjects),
        "flatWindows": flat,
        "lagSecondsBySubject": {analysis.subject: analysis.lag_s for analysis in analyses},
        **rhythm_bias_report(windows, af_subjects, non_af_subjects),
    }


def read_diabetes_scores(path: Path, entry: dict, holdout: set[int]) -> tuple[Units, dict]:
    # Written by the diabetes pipeline (track/ml-diabetes) inside the approved run: one P(pattern) per
    # locked-holdout patient from the shipped ONNX file, plus how many holdout patients had no PLETH.
    scores = json.loads(Path(path).read_text(encoding="utf-8"))
    expected = {"model": entry["name"], "version": entry["version"], "onnxSha256": entry["sha256"]}
    expected["dataset"] = entry["externalTest"]["dataset"]
    wrong = [
        f"{key} is {scores.get(key)!r}, expected {value!r}"
        for key, value in expected.items()
        if scores.get(key) != value
    ]
    rows = scores.get("subjects")
    if not isinstance(rows, list) or not rows:
        wrong.append("subjects must be a non-empty list")
        rows = []
    ids = [row.get("subject") for row in rows]
    if len(set(ids)) != len(ids):
        wrong.append("a subject appears more than once")
    if not all(isinstance(subject, int) and subject in holdout for subject in ids):
        wrong.append(f"every subject must be a locked holdout patient in {SPLIT_FILE.name}")
    if not all(isinstance(row.get("diabetic"), bool) for row in rows):
        wrong.append("diabetic must be true or false for every subject")
    if not all(isinstance(row.get("score"), float | int) and 0 <= row["score"] <= 1 for row in rows):
        wrong.append("score must be a probability for every subject")
    if not (isinstance(scores.get("holdoutWithoutPleth"), int) and scores["holdoutWithoutPleth"] >= 0):
        wrong.append("holdoutWithoutPleth must be a count")
    if wrong:
        raise ValueError(f"{path}: " + "; ".join(wrong))
    units = Units(
        np.asarray([row["score"] for row in rows], dtype=float),
        np.asarray([row["diabetic"] for row in rows], dtype=bool),
        np.asarray([str(subject) for subject in ids], dtype=str),
    )
    return units, scores


def diabetes_part(entry: dict, units: Units, scores_file: dict) -> dict:
    tau = frozen_threshold(entry, "diabetes")
    report = binary_report(units, tau, DIABETES_PREVALENCES)
    met = floor_met(report, DIABETES_FLOOR)
    return {
        "model": model_id(entry),
        "dataset": entry["externalTest"]["dataset"],
        "subjects": report["units"],
        "diabeticSubjects": report["positives"],
        "nonDiabeticSubjects": report["negatives"],
        "holdoutWithoutPleth": scores_file["holdoutWithoutPleth"],
        **{
            key: report[key] for key in ("threshold", "auroc", "sensitivity", "specificity", "ci95", "ppvNpv")
        },
        "undefinedResamples": report["undefinedResamples"],
        "floor": DIABETES_FLOOR,
        "floorMet": met,
        # ML-6: below the floor the output is Experimental and never flagged.
        "outcome": "flaggable" if met else "experimental",
    }


def preflight(
    parts: Sequence[str], models_dir: Path, dataset_dir: Path, diabetes_scores: Path | None
) -> dict:
    # Everything that can fail without touching external data fails here, before the ledger records a
    # start, so a missing file never uses up the owner's approval.
    entries = {}
    if "rhythm" in parts:
        entries["rhythm"] = family_entries(models_dir, "rhythm")
        for entry in entries["rhythm"]:
            if not (
                "af" in entry["labels"]
                and set(entry["inputs"]) <= set(RHYTHM_INPUTS)
                and isinstance(entry.get("abstainBelow"), int | float)
            ):
                raise ExternalTestRefusedError(
                    f"{model_id(entry)} needs an af label, inputs from {RHYTHM_INPUTS} and abstainBelow"
                )
    if "sqi" in parts:
        shipped = [entry for entry in family_entries(models_dir, "sqi") if entry["ships"]]
        if shipped[0]["inputs"].get("window", [None, None])[1] != 1:
            raise ExternalTestRefusedError(
                "ADR 0028 runs the one-channel SQI-Net v1; the shipped entry differs"
            )
        entries["sqi"] = shipped
    if "diabetes" in parts:
        entries["diabetes"] = [entry for entry in family_entries(models_dir, "diabetes") if entry["ships"]]
        if diabetes_scores is None or not diabetes_scores.is_file():
            raise ExternalTestRefusedError("the diabetes part needs --diabetes-scores, a file that exists")
    if {"rhythm", "sqi"} & set(parts):
        beat_modules()
        if not (dataset_dir / download.MARKER_NAME).is_file() or not all(
            (dataset_dir / name).is_file()
            for name in ("mimic_perform_af_wfdb.zip", "mimic_perform_non_af_wfdb.zip")
        ):
            raise ExternalTestRefusedError(
                f"{dataset_dir} is not downloaded; the owner's approval step downloads it "
                "(LUMEN_EXTERNAL_APPROVED=1 python -m datasets.download --external)"
            )
    return entries


def analyse_mimic(dataset_dir: Path, rhythm: bool, sqi: bool) -> tuple[list[RecordingAnalysis], list[dict]]:
    analyses, excluded = [], []
    for path, is_af in record_paths(dataset_dir):
        try:
            recording = load_recording(path, is_af)
        except ChannelError as error:
            excluded.append({"record": path.name, "reason": str(error)})
            continue
        log.info("analysing %s", recording.subject)
        analyses.append(analyse(recording, rhythm=rhythm, sqi=sqi))
    return analyses, excluded


def run(
    parts: Sequence[str],
    *,
    models_dir: Path,
    results_path: Path,
    approval_path: Path,
    dataset_dir: Path,
    diabetes_scores: Path | None,
    commit: str,
    now: Callable[[], str],
) -> dict:
    # §11.5: approval-gated, once per model version, each model judged at its frozen threshold.
    entries = preflight(parts, models_dir, dataset_dir, diabetes_scores)
    approval = read_approval(approval_path)
    results = read_results(results_path)
    runs = {
        family: [
            {
                "model": model_id(entry),
                "family": family,
                "approval": approval.request,
                "commit": commit,
                "onnxSha256": entry["sha256"],
            }
            for entry in family_list
        ]
        for family, family_list in entries.items()
    }
    check_gate([run["model"] for family_runs in runs.values() for run in family_runs], approval, results)
    start_runs(results, [run for family_runs in runs.values() for run in family_runs], now())
    write_results(results_path, results)

    if {"rhythm", "sqi"} & set(parts):
        analyses, excluded = analyse_mimic(dataset_dir, rhythm="rhythm" in parts, sqi="sqi" in parts)
        counts = {
            "af": sum(analysis.is_af for analysis in analyses),
            "nonAf": sum(not analysis.is_af for analysis in analyses),
        }
        for family in ("rhythm", "sqi"):
            if family not in parts:
                continue
            part = (
                rhythm_part(entries["rhythm"], analyses, models_dir)
                if family == "rhythm"
                else sqi_part(entries["sqi"][0], analyses, models_dir)
            )
            results[family] = {
                **part,
                "subjectsLoaded": counts,
                "subjectsExpected": EXPECTED_SUBJECTS,
                "excludedRecords": excluded,
            }
            finish_runs(runs[family], now())
            write_results(results_path, results)
    if "diabetes" in parts:
        (entry,) = entries["diabetes"]
        units, scores_file = read_diabetes_scores(diabetes_scores, entry, set(load_split()["holdout"]))
        results["diabetes"] = diabetes_part(entry, units, scores_file)
        finish_runs(runs["diabetes"], now())
        write_results(results_path, results)
    return results


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="One-time external test (§11.5, ML-1, ML-4, ML-6); needs the owner's approval file."
    )
    parser.add_argument("--rhythm", action="store_true", help="ML-1 on MIMIC PERform AF")
    parser.add_argument("--sqi", action="store_true", help="ML-4 rhythm-bias check on MIMIC PERform AF")
    parser.add_argument(
        "--diabetes-scores", type=Path, help="ML-6: holdout scores from the diabetes pipeline"
    )
    parser.add_argument("--all", action="store_true", help="rhythm, sqi and diabetes")
    args = parser.parse_args(argv)
    parts = [
        part
        for part, chosen in (
            ("rhythm", args.rhythm or args.all),
            ("sqi", args.sqi or args.all),
            ("diabetes", args.diabetes_scores is not None or args.all),
        )
        if chosen
    ]
    if not parts:
        parser.error("choose --rhythm, --sqi, --diabetes-scores, or --all")
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    # Paths are fixed here so no flag can point the once-per-version ledger somewhere else.
    run(
        parts,
        models_dir=MODELS_DIR,
        results_path=RESULTS_FILE,
        approval_path=APPROVAL_FILE,
        dataset_dir=MIMIC.local_dir,
        diabetes_scores=args.diabetes_scores,
        commit=git_commit(),
        now=lambda: datetime.now(UTC).isoformat(timespec="seconds"),
    )
    print(RESULTS_FILE)


if __name__ == "__main__":
    main()
