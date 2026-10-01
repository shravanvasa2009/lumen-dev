from lumen_dsp.golden import serialize, shape_vectors


def test_shape_vectors_are_deterministic():
    assert serialize(shape_vectors()) == serialize(shape_vectors())


def test_shape_cases_cover_a_full_result_and_both_null_paths():
    cases = {case["name"]: case for case in shape_vectors()["cases"]}
    full = cases["jittered-72-bpm"]["expected"]
    assert full["beatsUsed"] >= 20
    assert len(full["beat"]) == 256
    assert full["waves"]["a"] is not None
    assert cases["too-few-normal-beats"]["expected"] is None
    assert cases["below-60-fps"]["expected"] is None
