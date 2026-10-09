import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pytest

from lumen_dsp.rhythm import judges_rhythm, reading_wide_window

# Red team (§16) for PR #299 (SQI-Net advisory, owner 2026-10-06). SQI-Net was the only check that refused a
# covered lens with no pulse; its scores now reject nothing, so the rhythm rows of pure noise reach the rhythm
# model. The rows are core's (packages/core/test/redteam/sqi-advisory-noise.test.ts checks they reproduce from
# coveredNoise): 72 captures of low-passed Gaussian noise, Quick 35 s and Full 95 s, 30 and 60 fps, no SQI.

REPO = Path(__file__).resolve().parents[3]
CASES = json.loads(
    (REPO / "packages" / "core" / "test" / "redteam" / "fixtures" / "noise-rhythm-rows.json").read_text(
        encoding="utf-8"
    )
)["cases"]
MANIFEST = json.loads((REPO / "models" / "manifest.json").read_text(encoding="utf-8"))
RHYTHM_MODELS = [
    entry
    for entry in MANIFEST["models"]
    if entry["family"] == "rhythm" and set(entry["inputs"]) == {"features"}
]
# The rhythm flag's model gate (ADR 0104): rules.uncertainBelowTopProb and confidence.highTopProb.
ABSTAIN_BELOW = 0.6
HIGH_TOP_PROB = 0.8
RHYTHM_CLASS_MIN_INTERVALS = 20


def _judged(case):
    return (
        case["standardRows"] > 0
        or case["windowIntervals"] is None
        or (case["windowIntervals"] >= RHYTHM_CLASS_MIN_INTERVALS)
    )


def _reading_probs(entry, rows):
    session = ort.InferenceSession(str(REPO / "models" / entry["file"]))
    width = entry["inputs"]["features"][1]
    features = np.asarray([row[:width] for row in rows], dtype=np.float32)
    return session.run(None, {"features": features})[0].astype(float).mean(axis=0)


def _af_flagged(entry):
    for case in CASES:
        if not case["rows"] or not _judged(case):
            continue
        probs = _reading_probs(entry, case["rows"])
        if (
            probs[int(np.argmax(probs))] >= max(ABSTAIN_BELOW, HIGH_TOP_PROB)
            and probs[1] >= entry["threshold"]["af"]
        ):
            yield case["name"]


def test_the_noise_rows_reach_the_rhythm_model():
    assert len(CASES) == 72
    assert sum(1 for case in CASES if case["rows"] and _judged(case)) > 40


# OWNER DECISION. Found by red team on PR #299: the shipped rhythm-lgbm puts P(AF) ≥ 0.8 on 43 of the 72 noise
# captures (19 of them with standard 32-interval windows) and rhythm-logistic on 53, so pure noise reads
# "irregular" and, with one earlier positive, "Possible AFib". Core now gives no rhythm class when SQI-Net
# flagged more than rules.rhythmMaxSqiFlaggedShare of the windows (pending owner confirmation); these rows
# carry no SQI scores, as on a phone without SQI-Net, where the flag is tagged noSqi. Strict: passes while
# the models flag noise, turns red once neither does.
@pytest.mark.xfail(
    strict=True, reason="the rhythm models call noise AF; without SQI-Net only a tag remains; owner to decide"
)
@pytest.mark.parametrize("entry", RHYTHM_MODELS, ids=[entry["name"] for entry in RHYTHM_MODELS])
def test_pure_noise_never_gets_an_af_flag(entry):
    assert list(_af_flagged(entry)) == []


def test_the_lgbm_row_core_replays_is_the_model_output():
    # sqi-advisory-noise.test.ts feeds buildReadingResult rhythm-lgbm's output for this one-row case.
    lgbm = next(entry for entry in RHYTHM_MODELS if entry["name"] == "rhythm-lgbm")
    case = next(case for case in CASES if case["name"] == "noise full 30 fps smoothing 0.8 seed 2")
    assert len(case["rows"]) == 1
    assert np.allclose(_reading_probs(lgbm, case["rows"]), [0.008, 0.869, 0.123], atol=1e-3)


def test_judges_rhythm_agrees_with_core_on_the_noise_windows():
    for case in CASES:
        if case["windowIntervals"] is None:
            continue
        count = case["windowIntervals"]
        window = reading_wide_window([0.6] * count, [False] * count, [False] * (count + 1))
        assert judges_rhythm(window) == (count >= RHYTHM_CLASS_MIN_INTERVALS)
