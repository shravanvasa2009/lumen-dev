import json

from lumen_dsp.golden_rhythm import CHECK_TOLERANCE, golden_rhythm, main, serialize


def cases_by_name():
    return {case["name"]: case for case in golden_rhythm()["cases"]}


def test_generation_is_deterministic():
    assert serialize(golden_rhythm()) == serialize(golden_rhythm())


def test_cases_cover_the_required_situations():
    cases = cases_by_name()
    assert set(cases) == {
        "regular-sinus",
        "af-like",
        "sinus-premature",
        "artifact-gaps",
        "usable-39",
        "usable-40",
    }
    assert cases["usable-39"]["expected"]["hasEnoughUsableIntervals"] is False
    assert cases["usable-40"]["expected"]["hasEnoughUsableIntervals"] is True
    gap_starts = [window["startInterval"] for window in cases["artifact-gaps"]["expected"]["windows"]]
    assert gap_starts == [0, 42, 58]
    premature = cases["sinus-premature"]["expected"]["windows"]
    assert any(window["atypicalFraction"] > 0 for window in premature)
    af_entropy = cases["af-like"]["expected"]["windows"][0]["shannonEntropyBits"]
    sinus_entropy = cases["regular-sinus"]["expected"]["windows"][0]["shannonEntropyBits"]
    assert af_entropy > sinus_entropy


def test_check_passes_on_a_fresh_file_and_fails_on_real_drift(tmp_path):
    target = tmp_path / "rhythm.json"
    assert main(["--out", str(target)]) == 0
    assert main(["--out", str(target), "--check"]) == 0

    content = json.loads(target.read_text(encoding="utf-8"))
    window = content["cases"][0]["expected"]["windows"][0]
    window["normalizedRmssd"] *= 1 + CHECK_TOLERANCE / 10
    target.write_text(json.dumps(content), encoding="utf-8")
    assert main(["--out", str(target), "--check"]) == 0

    window["normalizedRmssd"] *= 1 + 1e-9
    target.write_text(json.dumps(content), encoding="utf-8")
    assert main(["--out", str(target), "--check"]) == 1


def test_check_fails_when_the_file_is_missing(tmp_path):
    assert main(["--out", str(tmp_path / "rhythm.json"), "--check"]) == 1
