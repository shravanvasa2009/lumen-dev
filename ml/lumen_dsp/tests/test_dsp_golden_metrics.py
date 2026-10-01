import json

from lumen_dsp.golden import main, metrics_vectors, serialize


def readings_by_name():
    return {reading["name"]: reading["expected"] for reading in metrics_vectors()["readings"]}


def test_generation_is_deterministic():
    assert serialize(metrics_vectors()) == serialize(metrics_vectors())


def test_cases_cover_the_gates_and_the_breathing_fusion():
    readings = readings_by_name()
    assert set(readings) == {
        "sinus-two-segments",
        "af-like",
        "breathing-disagree",
        "deep-hrv-330s",
        "hrv-filter-30fps",
        "hrv-filter-60fps",
        "short-14s",
    }
    assert readings["sinus-two-segments"]["breathing"]["rateBrpm"] is not None
    assert readings["sinus-two-segments"]["hrv"]["sdnnMs"] is None
    assert len(readings["sinus-two-segments"]["series"]["amplitude"]) == 3  # an artifact and a segment gap
    assert readings["af-like"]["hrv"] is None
    assert readings["breathing-disagree"]["breathing"]["rateBrpm"] is None
    assert readings["deep-hrv-330s"]["hrv"]["sdnnMs"] is not None
    assert readings["hrv-filter-30fps"]["hrv"] is None
    assert readings["hrv-filter-60fps"]["hrv"]["rmssdMs"] is not None
    short = readings["short-14s"]
    assert (short["heartRate"], short["perfusionIndex"], short["breathing"]) == (None, None, None)
    assert short["hrv"]["rmssdMs"] is None


def test_hrv_filter_case_drops_exactly_the_stretched_interval():
    readings = {reading["name"]: reading for reading in metrics_vectors()["readings"]}
    beats = readings["hrv-filter-60fps"]["segments"][0]
    assert readings["hrv-filter-60fps"]["expected"]["hrv"]["nnIntervals"] == len(beats) - 2


def test_metrics_json_is_written_and_checked(tmp_path):
    assert main(["--out", str(tmp_path)]) == 0
    written = json.loads((tmp_path / "metrics.json").read_text(encoding="utf-8"))
    assert written["welch"]["expected"]["segments"] == 3
    assert main(["--out", str(tmp_path), "--check"]) == 0
