import logging
import math
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import NamedTuple

import numpy as np
import pandas as pd

from datasets import registry
from datasets.vitaldb_cases import eligible_cases, holdout_case_path, holdout_caseids
from eval.external import family_entries, model_id, onnx_output
from eval.external_gate import ExternalTestRefusedError
from export.provenance import sha256_of
from nets.diabetes_net import BEAT
from nets.rhythm_net import LABELS
from train import diabetes_features, vitaldb_pleth
from train.diabetes import TABULAR
from train.diabetes_features import RHYTHM_MODEL, OnnxRhythm, ShippedRhythm, shipped_abstain_below

# export/specs.py: diabetes-net's averaged-beat input; every other input is a featureOrder column list.
BEAT_INPUT = "beat"
RHYTHM_INPUT = "features"
# The dev cache's PLETH extraction used 6 workers; 4 keeps the owner's laptop responsive. About 1,500
# holdout cases at ~9 CPU seconds each.
WORKERS = 4
# Why a holdout patient has no score (ADR 0014 amendment, see score_holdout).
NO_PLETH_TRACK = "noPlethTrack"
NO_STABLE_WINDOW = "noStableWindow"
NO_SCORABLE_SEGMENT = "noScorableSegment"
VITALDB = next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb")

log = logging.getLogger("train.diabetes_holdout")


class CaseSegments(NamedTuple):
    dropped: str | None  # one of the NO_* reasons, or None when the case has a scorable segment
    segments: pd.DataFrame  # scorable segments: the TABULAR features and the averaged beat


def check_inputs(entry: dict) -> None:
    # The app fills a missing feature with fillMedians and feeds featureOrder; neither is in the ONNX
    # file (PR #119), so a model without them cannot be scored the way the app scores it.
    order, medians = entry.get("featureOrder"), entry.get("fillMedians")
    if not (isinstance(order, dict) and isinstance(medians, dict)):
        raise ExternalTestRefusedError(f"{model_id(entry)} has no featureOrder and fillMedians")
    for name, shape in entry["inputs"].items():
        if name == BEAT_INPUT:
            if shape[-1] != BEAT:
                raise ExternalTestRefusedError(
                    f"{model_id(entry)} takes a {shape[-1]}-sample beat, not {BEAT}"
                )
            continue
        columns = order.get(name)
        if not (isinstance(columns, list) and len(columns) == shape[-1] and set(columns) <= set(TABULAR)):
            raise ExternalTestRefusedError(f"{model_id(entry)}'s featureOrder does not give input {name}")
        fills = [medians.get(column) for column in columns]
        if not all(isinstance(fill, int | float) and math.isfinite(fill) for fill in fills):
            raise ExternalTestRefusedError(f"{model_id(entry)}'s fillMedians lack a value for input {name}")


def shipped_rhythm_entry(models_dir: Path) -> dict:
    # The dev cache labelled every segment with rhythm-lgbm (ADR 0047 addendum), so the holdout must be
    # labelled by that same model version, as this release ships it.
    (entry,) = [entry for entry in family_entries(models_dir, "rhythm") if entry["ships"]]
    if model_id(entry) != RHYTHM_MODEL.file_stem:
        raise ExternalTestRefusedError(
            f"the release ships {model_id(entry)}; diabetes training was labelled by {RHYTHM_MODEL.file_stem}"
        )
    if list(entry["inputs"]) != [RHYTHM_INPUT] or sorted(entry["labels"]) != sorted(LABELS):
        raise ExternalTestRefusedError(f"{model_id(entry)} needs input {RHYTHM_INPUT} and labels {LABELS}")
    if entry["abstainBelow"] != shipped_abstain_below():
        raise ExternalTestRefusedError(f"{model_id(entry)}'s abstainBelow is not the one training used")
    return entry


def release_rhythm_model(rhythm_entry: dict, models_dir: Path) -> ShippedRhythm:
    # The ONNX file in models_dir, not the pickle the dev cache loaded: ml/runs is not in the repo, so at
    # external-test time the release's ONNX is the only copy, and it is what the app runs. ML-3's parity
    # check (export.verify_onnx, models/parity.json) holds it to the pickle on float32 inputs, which is
    # what window_probs feeds both.
    return ShippedRhythm(
        OnnxRhythm(models_dir / rhythm_entry["file"], RHYTHM_INPUT, rhythm_entry["labels"]),
        rhythm_entry["sha256"],
        rhythm_entry["abstainBelow"],
    )


def case_segments(caseid: int, rhythm_entry: dict, models_dir: Path) -> CaseSegments:
    # The dev cache's steps on one case, without its files: vitaldb_pleth.extract_case's window choice,
    # load_segments' bands, and diabetes_features.segment_features, kept to the rows it trains on.
    record = vitaldb_pleth.read_holdout_pleth(holdout_case_path(caseid))
    if record is None:
        return CaseSegments(NO_PLETH_TRACK, pd.DataFrame())
    codes, starts_s, _ = vitaldb_pleth.selected_windows(record)
    if not starts_s:
        return CaseSegments(NO_STABLE_WINDOW, pd.DataFrame())
    rhythm_model = release_rhythm_model(rhythm_entry, models_dir)
    rows = []
    for window, start_s in zip(codes, starts_s, strict=True):
        bands = vitaldb_pleth.segment_bands(window, start_s, record.gain, record.offset)
        row, pulse_shape = diabetes_features.segment_features(bands, rhythm_model)
        # float32 as diabetes_features.segment_table stores it for training.
        rows.append({**row, "beat": None if pulse_shape is None else pulse_shape.beat.astype(np.float32)})
    table = pd.DataFrame(rows)
    usable = table[diabetes_features.scorable(table)][[*TABULAR, BEAT_INPUT]].reset_index(drop=True)
    return CaseSegments(None if len(usable) else NO_SCORABLE_SEGMENT, usable)


def model_inputs(entry: dict, segments: pd.DataFrame) -> dict[str, np.ndarray]:
    # train.diabetes.segment_set's conversion, in the manifest's feature order and with its fill values.
    inputs = {}
    for name in entry["inputs"]:
        if name == BEAT_INPUT:
            inputs[name] = np.stack(segments[BEAT_INPUT].to_numpy()).astype(np.float32)[:, None, :]
            continue
        columns = entry["featureOrder"][name]
        inputs[name] = segments[columns].astype(float).fillna(entry["fillMedians"]).to_numpy(np.float32)
    return inputs


def score_holdout(entry: dict, models_dir: Path, holdout: list[int]) -> dict:
    # Only eval.external calls this, inside its approved run. Every check that needs no holdout file
    # comes first.
    check_inputs(entry)
    path = models_dir / entry["file"]
    onnx_sha256 = sha256_of(path)
    if onnx_sha256 != entry["sha256"]:
        raise ExternalTestRefusedError(f"{path} does not match the manifest's sha256")
    rhythm_entry = shipped_rhythm_entry(models_dir)
    clinical = pd.read_csv(VITALDB.local_dir / "clinical_data.csv")
    caseids = holdout_caseids(clinical, holdout)

    cases: dict[int, CaseSegments] = {}
    with ProcessPoolExecutor(max_workers=min(WORKERS, len(holdout))) as pool:
        futures = {
            pool.submit(case_segments, caseids[subject], rhythm_entry, models_dir): subject
            for subject in holdout
        }
        for done, future in enumerate(as_completed(futures), start=1):
            cases[futures[future]] = future.result()
            if done % 100 == 0 or done == len(futures):
                log.info("%d / %d holdout cases", done, len(futures))
    # ADR 0014 makes a usable SNUADC/PLETH track part of eligibility, and its amendment drops at M3 the
    # holdout patients without one. Usable means what development trained on: a stable 90 s window
    # (vitaldb_pleth) with a segment diabetes_features.scorable keeps. A development patient without one
    # never reached training either, so these patients count in holdoutWithoutPleth, by reason.
    scored = [subject for subject in holdout if cases[subject].dropped is None]
    if not scored:
        raise ValueError("no holdout patient has a scorable PLETH segment")
    segments = pd.concat(
        [cases[subject].segments.assign(subject=subject) for subject in scored], ignore_index=True
    )
    # A patient's score is the mean over their segments, as train.diabetes.subject_units scores dev-val.
    scores = (
        pd.Series(onnx_output(path, model_inputs(entry, segments))[:, 0]).groupby(segments["subject"]).mean()
    )
    # ADR 0045: holdout labels are read here and nowhere else, after every score exists.
    preop_dm = eligible_cases(clinical).set_index("subjectid")["preop_dm"]
    reasons = Counter(cases[subject].dropped for subject in holdout if cases[subject].dropped is not None)
    log.info("%d holdout patients scored; without a usable PLETH segment: %s", len(scored), dict(reasons))
    return {
        "subjects": [
            {
                "subject": int(subject),
                "diabetic": bool(preop_dm[subject] == 1),
                "score": float(scores[subject]),
            }
            for subject in scored
        ],
        "holdoutWithoutPleth": len(holdout) - len(scored),
        "withoutPlethReasons": dict(reasons),
        "onnxSha256": onnx_sha256,
    }
