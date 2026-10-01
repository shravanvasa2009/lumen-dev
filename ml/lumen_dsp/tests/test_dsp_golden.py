import json

from lumen_dsp.golden import CHECK_TOLERANCE, golden_files, main, serialize


def test_generation_is_deterministic():
    first = {name: serialize(content) for name, content in golden_files().items()}
    second = {name: serialize(content) for name, content in golden_files().items()}
    assert first == second


def test_capture_has_an_exact_150_ms_gap_that_rounds_over_and_stays_bridged():
    files = golden_files()
    t_ns = files["timebase.json"]["samples"]["tNs"]
    t_s = files["timebase.json"]["expected"]["tS"]
    exact = [i for i in range(1, len(t_ns)) if t_ns[i] - t_ns[i - 1] == 150_000_000]
    assert len(exact) == 1
    assert t_s[exact[0]] - t_s[exact[0] - 1] > 0.15
    # Only the 200 ms gap splits the capture.
    for rate in files["resample.json"]["rates"]:
        assert len(rate["segments"]) == 2


def test_check_passes_on_fresh_files_and_fails_on_real_drift(tmp_path):
    assert main(["--out", str(tmp_path)]) == 0
    assert main(["--out", str(tmp_path), "--check"]) == 0

    target = tmp_path / "filters.json"
    content = json.loads(target.read_text(encoding="utf-8"))
    content["bandPass"][0]["zeroPhase"][10] += CHECK_TOLERANCE / 10
    target.write_text(json.dumps(content), encoding="utf-8")
    assert main(["--out", str(tmp_path), "--check"]) == 0

    content["bandPass"][0]["zeroPhase"][10] += 1e-9
    target.write_text(json.dumps(content), encoding="utf-8")
    assert main(["--out", str(tmp_path), "--check"]) == 1


def test_check_fails_when_a_file_is_missing(tmp_path):
    assert main(["--out", str(tmp_path), "--check"]) == 1
