import json
import math
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pytest

from lumen_dsp.breathing import breathing_estimates
from lumen_dsp.metrics import MeasuredBeat, low_quality_heart_rate, low_quality_rmssd
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.rhythm import (
    judges_rhythm,
    reading_wide_window,
    rhythm_feature_vector,
    rhythm_v2_features,
)
from lumen_dsp.shape import low_quality_ensemble_beat

# Red team (§16) for ADR 0104 at 3ad37eb: the Python half of
# packages/core/test/redteam/lower-quality-*.test.ts.
# The fixtures are written by core and checked there to reproduce from lower-quality-battery.ts.

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "packages" / "core" / "test" / "redteam" / "fixtures"
PARITY = json.loads((FIXTURES / "lower-quality-parity.json").read_text(encoding="utf-8"))["cases"]
ROWS = json.loads((FIXTURES / "lower-quality-rhythm-rows.json").read_text(encoding="utf-8"))["cases"]
MANIFEST = json.loads((REPO / "models" / "manifest.json").read_text(encoding="utf-8"))
# §10.2: the two languages agree within 1e-9.
TOLERANCE = 1e-9
# The rhythm flag's model gate (ADR 0104): the top class at rules.uncertainBelowTopProb and
# confidence.highTopProb.
ABSTAIN_BELOW = 0.6
HIGH_TOP_PROB = 0.8
# Feature-input rhythm models: the shipped one and the logistic one a rule fallback can run.
RHYTHM_MODELS = [
    entry
    for entry in MANIFEST["models"]
    if entry["family"] == "rhythm" and set(entry["inputs"]) == {"features"}
]


def _close(value, expected):
    if value is None or expected is None:
        return value is None and expected is None
    return abs(value - expected) <= TOLERANCE * max(1.0, abs(expected))


def _segments(case):
    return [
        [
            MeasuredBeat(peak_s=p, beat_class=c, long_pause=lp, amplitude=a, intensity=i, dc=d)
            for p, c, lp, a, i, d in segment
        ]
        for segment in case["input"]["segments"]
    ]


def _morphology(phases):
    return [
        math.sin(2 * math.pi * k / 205) + 0.3 * math.sin(4 * math.pi * k / 205 + phases[k % 16])
        for k in range(1024)
    ]


@pytest.mark.parametrize("case", PARITY, ids=[f"seed {case['input']['seed']}" for case in PARITY])
def test_lower_quality_functions_match_typescript(case):
    expected = case["expected"]
    segments = _segments(case)
    assert _close(low_quality_heart_rate(segments), expected["heartRateBpm"])

    rmssd = low_quality_rmssd(segments)
    assert (rmssd is None) == (expected["rmssd"] is None)
    if rmssd is not None:
        assert _close(rmssd.rmssd_ms, expected["rmssd"][0])
        assert rmssd.nn_intervals == expected["rmssd"][1]

    breathing = breathing_estimates(segments)
    for name, key in [
        ("rate_brpm", "rateBrpm"),
        ("intensity_brpm", "intensityBrpm"),
        ("amplitude_brpm", "amplitudeBrpm"),
        ("interval_brpm", "intervalBrpm"),
    ]:
        assert _close(getattr(breathing, name), expected["breathing"][key]), name

    inputs = case["input"]
    window = reading_wide_window(inputs["intervalsS"], inputs["spansArtifact"], inputs["atypicalBeats"])
    assert (window is None) == (expected["window"] is None)
    if window is not None:
        features = [window.start_interval, *rhythm_feature_vector(window), *rhythm_v2_features(window)]
        assert all(_close(value, want) for value, want in zip(features, expected["window"], strict=True))

    shape = low_quality_ensemble_beat(
        _morphology(inputs["morphologyPhases"]), inputs["onsets"], inputs["normal"]
    )
    assert (shape is None) == (expected["shape"] is None)
    if shape is not None:
        beat = np.asarray(shape.beat, dtype=float)
        assert np.max(np.abs(beat[::16] - np.asarray(expected["shape"]["beatEvery16"]))) <= TOLERANCE
        assert _close(float(beat.sum()), expected["shape"]["beatSum"])
        assert shape.beats_used == expected["shape"]["beatsUsed"]
        assert {key: getattr(shape.waves, key) for key in "abcde"} == {
            key: expected["shape"]["waves"][key] for key in "abcde"
        }


def _reading_probs(entry, rows):
    # The reading-level probabilities: the mean over the rows (readingRhythmProbs).
    session = ort.InferenceSession(str(REPO / "models" / entry["file"]))
    width = entry["inputs"]["features"][1]
    features = np.asarray([row[:width] for row in rows], dtype=np.float32)
    return session.run(None, {"features": features})[0].astype(float).mean(axis=0)


def _judged(case):
    # ADR 0104 answer 5 (owner 2026-10-06): a reading-wide row under rhythmClassMinIntervals gives no class
    # (judgesRhythm in core, judges_rhythm here).
    floor = DSP_CONFIG["lowQuality"]["rhythmClassMinIntervals"]
    return case["standardRows"] or case["windowIntervals"] >= floor


def _calls(entry, cases):
    tau_af = entry["threshold"]["af"]
    for case in cases:
        if not case["rows"]:
            continue
        probs = _reading_probs(entry, case["rows"])
        top = int(np.argmax(probs))
        judged = _judged(case)
        flagged = judged and probs[top] >= max(ABSTAIN_BELOW, HIGH_TOP_PROB) and probs[1] >= tau_af
        regular = judged and top == 0 and probs[top] >= ABSTAIN_BELOW
        yield case["name"], probs, flagged, regular


def _short(case):
    return case["mode"] == "full" and case["name"].endswith((" 4 s", " 6 s", " 8 s"))


SINUS = [case for case in ROWS if case["truth"] == "sinus"]
AF_LONG = [case for case in ROWS if case["truth"] == "af" and not _short(case)]
AF_SHORT = [case for case in ROWS if case["truth"] == "af" and _short(case)]


@pytest.mark.parametrize("entry", RHYTHM_MODELS, ids=[entry["name"] for entry in RHYTHM_MODELS])
def test_no_irregular_flag_on_sinus_with_premature_beats_under_the_relaxed_rule(entry):
    # 220 captures at 30 fps: Quick (31 s) and Full (45 s) at 50–110 bpm with PVCs or PACs every 3–12 beats,
    # and Full Scans with only 4–8 s of beats. At 3ad37eb neither model flags any (ML-5 counts these flags).
    flagged = [name for name, _, is_flagged, _ in _calls(entry, SINUS) if is_flagged]
    assert flagged == []


@pytest.mark.parametrize("entry", RHYTHM_MODELS, ids=[entry["name"] for entry in RHYTHM_MODELS])
def test_af_quick_and_sub_60_s_is_never_called_regular(entry):
    # 72 AF captures (70–120 bpm, CV 0.12–0.3), Quick 31 s and Full 45 s at 30 fps.
    regular = [name for name, _, _, is_regular in _calls(entry, AF_LONG) if is_regular]
    assert regular == []


# OWNER DECISION, answered 2026-10-06 (ADR 0104 answer 5). With only 4–8 s of AF beats a Full Scan has one
# reading-wide row of 4–13 intervals. At 3ad37eb a model could call it sinus, which headlined "Regular
# rhythm" and could clear a held possible-AFib result (isRegularFullCheck): rhythm-lgbm for 1 of 60 (AF
# 75 bpm, CV 0.2, seed 4, full 4 s: 0.663 / 0.056 / 0.282), rhythm-logistic for 10 of 60. Under 20
# intervals there is now no class, so none reads regular.
@pytest.mark.parametrize("entry", RHYTHM_MODELS, ids=[entry["name"] for entry in RHYTHM_MODELS])
def test_af_with_a_few_seconds_of_beats_is_never_called_regular(entry):
    assert all(not _judged(case) for case in AF_SHORT)
    regular = [name for name, _, _, is_regular in _calls(entry, AF_SHORT) if is_regular]
    assert regular == []


def test_short_reading_wide_rows_get_no_class_in_both_languages():
    # judges_rhythm reads the same floor core's judgesRhythm does, on the fixture's window lengths.
    assert len(AF_SHORT) == 60
    for case in ROWS:
        if case["windowIntervals"] is None:
            continue
        intervals = [0.8 if i % 2 == 0 else 0.9 for i in range(case["windowIntervals"])]
        n = len(intervals)
        window = reading_wide_window(intervals, [False] * n, [False] * (n + 1))
        assert judges_rhythm(window) == _judged(case)
