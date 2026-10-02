import argparse
import importlib
import inspect
import json
import logging
import math
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

import numpy as np
import onnxruntime as ort
import pandas as pd

from datasets import download, registry
from datasets.vitaldb_cases import SPLIT_FILE, holdout_case_path, holdout_caseids, load_split
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
    possible_af,
    rhythm_bias_report,
    rhythm_outcome,
)
from export.provenance import sha256_of
from export.specs import MODELS_DIR, SPECS
from export.write_manifest import git_commit
from nets.rhythm_net import LABELS
from train.rhythm import AF, Units, reading_units, sensitivity_at, specificity_at, subject_units, with_ci
from train.rhythm_windows import WindowSet, window_inputs

PARTS = ("rhythm", "sqi", "diabetes")
# The threshold each family's decision uses, as the manifest and model card freeze it.
THRESHOLD_KEYS = {"rhythm": "af", "sqi": "clean", "diabetes": "pattern"}
# The order train.rhythm_windows.window_inputs returns them in (ADR 0020).
RHYTHM_INPUTS = ("intervals", "mask", "features")
# MIMIC PERform AF labels subjects only "AF" or "not AF". train.rhythm's reading_units and subject_units
# read only labels == AF, so every non-AF window carries this other index.
NOT_AF = LABELS.index("other")
# Reading id = subject index × this + 90 s block, so ids sort by subject, then time, and decode back.
BLOCKS_PER_SUBJECT = 1000
# ADR 0045: the diabetes pipeline's holdout scorer, called only from run() after the ledger records a
# start: score_holdout(entry, models_dir, holdout_ids) -> {"onnxSha256", "holdoutWithoutPleth",
# "subjects": [{"subject", "diabetic", "score"}]}, scoring models_dir / entry["file"] with onnxruntime.
DIABETES_SCORER = "train.diabetes_holdout"
HOLDOUT_DATASET = "vitaldb-holdout"
MIMIC = next(dataset for dataset in registry.DATASETS if dataset.key == "mimic-perform-af")

log = logging.getLogger("eval.external")

HoldoutScorer = Callable[[dict, Path, list[int]], dict]


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


def window_set(analyses: list[RecordingAnalysis]) -> WindowSet:
    rows = [
        (
            *window_inputs(window),
            AF if analysis.is_af else NOT_AF,
            analysis.subject,
            index * BLOCKS_PER_SUBJECT + block,
        )
        for index, analysis in enumerate(analyses)
        for block, window in analysis.rhythm
    ]
    if not rows:
        raise ValueError("no subject produced a DSP-15 window")
    intervals, mask, features, labels, subjects, readings = zip(*rows, strict=True)
    return WindowSet(
        np.stack(intervals),
        np.stack(mask),
        np.stack(features),
        np.asarray(labels, dtype=np.int64),
        np.asarray(subjects, dtype=str),
        np.asarray(readings, dtype=np.int64),
    )


def rhythm_role(entry: dict) -> str:
    if entry["ships"]:
        return "shipped"
    spec = SPECS.get(entry["name"])
    # ADR 0031: a non-shipped neural model is the ablation; classical models are ML-1 baselines.
    return "baseline" if spec is not None and spec.kind == "classifier" else "ablation"


def app_readings(
    probs: np.ndarray, windows: WindowSet, analyses: list[RecordingAnalysis], tau: float, abstain_below: float
) -> dict:
    # §11.5 "scored like the app scores a reading" (ADR 0041). A reading has a rhythm card when it has a
    # DSP-15 window and ≥ 40 usable intervals; the card abstains when the top of its mean probabilities is
    # below abstainBelow; it is positive when it answers and P(AF) ≥ τ_AF. Every 90 s block is a saved
    # reading in the 2-of-3 history, so a block without a card counts as a negative reading. Not applied:
    # the 60 clean-second floor and card confidence, which need camera coverage and SQI.
    ids = np.unique(windows.readings)
    by_class = np.column_stack([reading_units(probs[:, k], windows).scores for k in range(probs.shape[1])])
    readings = reading_units(probs[:, AF], windows)
    top = by_class.max(axis=1)
    has_card = np.asarray(
        [
            analyses[reading // BLOCKS_PER_SUBJECT].enough_intervals.get(reading % BLOCKS_PER_SUBJECT, False)
            for reading in ids
        ]
    )
    answered = has_card & (top >= abstain_below)
    positive_ids = set(ids[answered & (readings.scores >= tau)].tolist())
    history = [
        (analysis.subject, analysis.is_af, index * BLOCKS_PER_SUBJECT + block in positive_ids)
        for index, analysis in enumerate(analyses)
        for block in range(analysis.blocks)
    ]
    subjects = np.asarray([subject for subject, _is_af, _positive in history])
    flags = possible_af(np.asarray([positive for _s, _a, positive in history]), subjects)
    # A subject is called AF when any of its readings is flagged possible AF.
    called = Units(
        np.asarray([float(flags[subjects == analysis.subject].any()) for analysis in analyses]),
        np.asarray([analysis.is_af for analysis in analyses]),
        np.asarray([analysis.subject for analysis in analyses]),
    )
    return {
        "readings": len(history),
        "readingsWithRhythmCard": int(has_card.sum()),
        "abstainRate": with_ci(
            Units(top[has_card], readings.is_af[has_card], readings.subjects[has_card]),
            lambda _is_af, values: float(np.mean(values < abstain_below)),
        ),
        "answered": binary_report(
            Units(readings.scores[answered], readings.is_af[answered], readings.subjects[answered]), tau, ()
        ),
        "possibleAfSubjects": {
            "subjects": len(analyses),
            "sensitivity": with_ci(called, sensitivity_at(0.5)),
            "specificity": with_ci(called, specificity_at(0.5)),
        },
    }


def rhythm_part(entries: list[dict], analyses: list[RecordingAnalysis], models_dir: Path) -> dict:
    windows = window_set(analyses)
    batch = dict(zip(RHYTHM_INPUTS, (windows.intervals, windows.mask, windows.features), strict=True))
    reports = {}
    for entry in entries:
        tau = frozen_threshold(entry, "rhythm")
        probs = onnx_output(models_dir / entry["file"], {name: batch[name] for name in entry["inputs"]})
        # Columns put in train.rhythm's LABELS order, whatever order the manifest lists them in.
        probs = probs[:, [entry["labels"].index(label) for label in LABELS]]
        scores = probs[:, AF]
        subject_report = binary_report(subject_units(scores, windows), tau, RHYTHM_PREVALENCES)
        reports[entry["name"]] = {
            "model": model_id(entry),
            "role": rhythm_role(entry),
            "subject": subject_report,
            "reading": binary_report(reading_units(scores, windows), tau, ()),
            "window": binary_report(Units(scores, windows.labels == AF, windows.subjects), tau, ()),
            "appReadings": app_readings(probs, windows, analyses, tau, entry["abstainBelow"]),
            "floorMet": floor_met(subject_report, RHYTHM_FLOOR),
            "targetAurocMet": floor_met(subject_report, {"auroc": RHYTHM_TARGET_AUROC}),
        }
    shipped = next(name for name, report in reports.items() if report["role"] == "shipped")
    baselines = [name for name, report in reports.items() if report["role"] == "baseline"]
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
        **rhythm_outcome({name: report["subject"] for name, report in reports.items()}, shipped, baselines),
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


def diabetes_scorer() -> HoldoutScorer:
    # Imported only when the diabetes part runs, so this module loads before track/ml-diabetes merges.
    try:
        module = importlib.import_module(DIABETES_SCORER)
    except ModuleNotFoundError as error:
        if error.name != DIABETES_SCORER:
            raise
        raise ExternalTestRefusedError(
            f"{DIABETES_SCORER}.score_holdout (the diabetes pipeline's holdout scorer) is not on this branch"
        ) from error
    return module.score_holdout


def holdout_units(scored: dict, holdout: list[int], onnx_sha256: str) -> Units:
    # One P(pattern) per locked-holdout patient. ADR 0014's amendment lets only patients without PLETH
    # drop out, so the scored patients plus those must be the whole holdout.
    rows = scored.get("subjects")
    wrong = []
    if scored.get("onnxSha256") != onnx_sha256:
        wrong.append(
            f"scored with ONNX sha256 {scored.get('onnxSha256')!r}, not the manifest's {onnx_sha256}"
        )
    if not isinstance(rows, list) or not rows:
        wrong.append("subjects must be a non-empty list")
        rows = []
    ids = [row.get("subject") for row in rows]
    locked = set(holdout)
    if len(set(ids)) != len(ids):
        wrong.append("a subject appears more than once")
    if not all(isinstance(subject, int) and subject in locked for subject in ids):
        wrong.append(f"every subject must be a locked holdout patient in {SPLIT_FILE.name}")
    if not all(isinstance(row.get("diabetic"), bool) for row in rows):
        wrong.append("diabetic must be true or false for every subject")
    if not all(isinstance(row.get("score"), float | int) and 0 <= row["score"] <= 1 for row in rows):
        wrong.append("score must be a probability for every subject")
    without_pleth = scored.get("holdoutWithoutPleth")
    if not (isinstance(without_pleth, int) and without_pleth >= 0):
        wrong.append("holdoutWithoutPleth must be a count")
    elif len(ids) + without_pleth != len(holdout):
        wrong.append(
            f"{len(ids)} scored + {without_pleth} without PLETH is not the {len(holdout)} holdout "
            "patients (ADR 0014)"
        )
    if wrong:
        raise ValueError("holdout scores: " + "; ".join(wrong))
    return Units(
        np.asarray([row["score"] for row in rows], dtype=float),
        np.asarray([row["diabetic"] for row in rows], dtype=bool),
        np.asarray([str(subject) for subject in ids], dtype=str),
    )


def diabetes_part(entry: dict, units: Units, scored: dict) -> dict:
    tau = frozen_threshold(entry, "diabetes")
    report = binary_report(units, tau, DIABETES_PREVALENCES)
    met = floor_met(report, DIABETES_FLOOR)
    return {
        "model": model_id(entry),
        "dataset": HOLDOUT_DATASET,
        "subjects": report["units"],
        "diabeticSubjects": report["positives"],
        "nonDiabeticSubjects": report["negatives"],
        "holdoutWithoutPleth": scored["holdoutWithoutPleth"],
        **{
            key: report[key] for key in ("threshold", "auroc", "sensitivity", "specificity", "ci95", "ppvNpv")
        },
        "undefinedResamples": report["undefinedResamples"],
        "floor": DIABETES_FLOOR,
        "floorMet": met,
        # ML-6: below the floor the output is Experimental and never flagged.
        "outcome": "flaggable" if met else "experimental",
    }


class Preflight(NamedTuple):
    entries: dict[str, list[dict]]
    score_holdout: HoldoutScorer | None
    holdout: list[int]


def preflight(parts: Sequence[str], models_dir: Path, dataset_dir: Path) -> Preflight:
    # Everything that can fail without touching external data or labels fails here, before the ledger
    # records a start, so a missing file never uses up the owner's approval.
    entries, score_holdout, holdout = {}, None, []
    if "rhythm" in parts:
        entries["rhythm"] = family_entries(models_dir, "rhythm")
        for entry in entries["rhythm"]:
            if not (
                set(LABELS) <= set(entry["labels"])
                and set(entry["inputs"]) <= set(RHYTHM_INPUTS)
                and isinstance(entry.get("abstainBelow"), int | float)
            ):
                raise ExternalTestRefusedError(
                    f"{model_id(entry)} needs labels {LABELS}, inputs from {RHYTHM_INPUTS} and abstainBelow"
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
        dataset = (entries["diabetes"][0].get("externalTest") or {}).get("dataset")
        if dataset != HOLDOUT_DATASET:
            raise ExternalTestRefusedError(
                f"the shipped diabetes entry's external dataset is {dataset!r}, not {HOLDOUT_DATASET}"
            )
        holdout = load_split()["holdout"]
        if not holdout:
            raise ExternalTestRefusedError(f"{SPLIT_FILE} lists no holdout patients")
        score_holdout = diabetes_scorer()
        try:
            inspect.signature(score_holdout).bind(entries["diabetes"][0], models_dir, holdout)
        except TypeError as error:
            raise ExternalTestRefusedError(
                f"{DIABETES_SCORER}.score_holdout must take (entry, models_dir, holdout_ids): {error}"
            ) from error
        vitaldb = next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb")
        if not download.is_complete(vitaldb):
            raise ExternalTestRefusedError("the VitalDB tables are not downloaded (datasets.download --open)")
        caseids = holdout_caseids(pd.read_csv(vitaldb.local_dir / "clinical_data.csv"), holdout)
        missing = [caseid for caseid in caseids.values() if not holdout_case_path(caseid).is_file()]
        if missing:
            raise ExternalTestRefusedError(
                f"{len(missing)} of {len(caseids)} holdout .vital files are missing; the owner's approval "
                "step downloads them (LUMEN_EXTERNAL_APPROVED=1 python -m datasets.vitaldb_cases "
                "--download-holdout)"
            )
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
    return Preflight(entries, score_holdout, holdout)


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
    commit: str,
    now: Callable[[], str],
) -> dict:
    # §11.5: approval-gated, once per model version, each model judged at its frozen threshold.
    checked = preflight(parts, models_dir, dataset_dir)
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
        for family, family_list in checked.entries.items()
    }
    check_gate([run for family_runs in runs.values() for run in family_runs], approval, results)
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
                rhythm_part(checked.entries["rhythm"], analyses, models_dir)
                if family == "rhythm"
                else sqi_part(checked.entries["sqi"][0], analyses, models_dir)
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
        (entry,) = checked.entries["diabetes"]
        # The holdout is read only here, inside the approved run whose start the ledger already holds.
        scored = checked.score_holdout(entry, models_dir, checked.holdout)
        results["diabetes"] = diabetes_part(
            entry, holdout_units(scored, checked.holdout, entry["sha256"]), scored
        )
        finish_runs(runs["diabetes"], now())
        write_results(results_path, results)
    return results


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="One-time external test (§11.5, ML-1, ML-4, ML-6); needs the owner's approval file."
    )
    parser.add_argument("--rhythm", action="store_true", help="ML-1 on MIMIC PERform AF")
    parser.add_argument("--sqi", action="store_true", help="ML-4 rhythm-bias check on MIMIC PERform AF")
    parser.add_argument("--diabetes", action="store_true", help="ML-6 on the locked VitalDB holdout")
    parser.add_argument("--all", action="store_true", help="rhythm, sqi and diabetes")
    args = parser.parse_args(argv)
    parts = [
        part
        for part, chosen in (
            ("rhythm", args.rhythm or args.all),
            ("sqi", args.sqi or args.all),
            ("diabetes", args.diabetes or args.all),
        )
        if chosen
    ]
    if not parts:
        parser.error("choose --rhythm, --sqi, --diabetes, or --all")
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    # Paths are fixed here so no flag can point the once-per-version ledger somewhere else.
    run(
        parts,
        models_dir=MODELS_DIR,
        results_path=RESULTS_FILE,
        approval_path=APPROVAL_FILE,
        dataset_dir=MIMIC.local_dir,
        commit=git_commit(),
        now=lambda: datetime.now(UTC).isoformat(timespec="seconds"),
    )
    print(RESULTS_FILE)


if __name__ == "__main__":
    main()
