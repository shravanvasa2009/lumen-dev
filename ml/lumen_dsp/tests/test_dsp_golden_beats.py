import json

from lumen_dsp.golden import CHECK_TOLERANCE, beat_vectors, golden_files, main, serialize


def cases_by_name():
    return {case["name"]: case for case in beat_vectors()["cases"]}


def test_generation_is_deterministic():
    assert serialize(beat_vectors()) == serialize(beat_vectors())


def test_beats_json_joins_the_existing_files_without_changing_them():
    assert list(golden_files()) == [
        "timebase.json",
        "resample.json",
        "filters.json",
        "zscore.json",
        "rhythm.json",
        "beats.json",
        "shape.json",
    ]


def test_cases_cover_the_required_situations():
    cases = cases_by_name()
    assert set(cases) == {
        "regular-sinus",
        "dicrotic-heavy",
        "premature",
        "af-like",
        "bigeminy",
        "spans-and-pauses",
        "noise",
    }
    assert cases["regular-sinus"]["firstIndex256"] > 0

    def classes(name):
        return [beat["beatClass"] for beat in cases[name]["expected"]["classified"]]

    assert set(classes("regular-sinus")) == {"normal"}
    assert "atypical" in classes("premature")
    assert "artifact" not in classes("af-like")
    assert "artifact" in classes("spans-and-pauses")
    assert any(beat["longPause"] for beat in cases["spans-and-pauses"]["expected"]["classified"])
    dicrotic = cases["dicrotic-heavy"]["expected"]["detected"]
    assert len(dicrotic) > 1.5 * len(cases["dicrotic-heavy"]["truePeaksS"])


def test_the_64_hz_input_is_every_fourth_256_hz_sample():
    for case in beat_vectors()["cases"]:
        assert case["firstIndex256"] % 4 == 0
        assert len(case["morphology256"]) >= 8 * 256


def test_check_covers_beats_json(tmp_path):
    assert main(["--out", str(tmp_path)]) == 0
    assert main(["--out", str(tmp_path), "--check"]) == 0

    target = tmp_path / "beats.json"
    content = json.loads(target.read_text(encoding="utf-8"))
    beat = content["cases"][0]["expected"]["detected"][0]
    beat["peakS"] *= 1 + CHECK_TOLERANCE / 10
    target.write_text(json.dumps(content), encoding="utf-8")
    assert main(["--out", str(tmp_path), "--check"]) == 0

    content["cases"][0]["expected"]["classified"][0]["beatClass"] = "atypical"
    target.write_text(json.dumps(content), encoding="utf-8")
    assert main(["--out", str(tmp_path), "--check"]) == 1
