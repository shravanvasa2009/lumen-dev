import json
import math

import numpy as np
import pytest

from export.write_manifest import RULE_METHOD as MANIFEST_RULE_METHOD
from lumen_dsp.rhythm import RHYTHM_FEATURE_NAMES
from lumen_dsp.rhythm_rule import RULE_METHOD, RuleError, check_rule, rule_probs
from lumen_dsp.rule_fixture import FIXTURE_PATH, fitted_rule, rule_fixture


# 2 of 4 features; zero mean and unit scale, so z is the raw feature, and the logits are easy by hand.
def toy_rule(**changes):
    rule = {
        "method": RULE_METHOD,
        "features": ["first", "third"],
        "featureIndices": [0, 2],
        "mean": [0.0, 0.0],
        "scale": [1.0, 1.0],
        "classes": ["sinus", "af", "other"],
        "coefficients": [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        "intercepts": [0.0, 0.0, 0.0],
    }
    return {**rule, **changes}


def test_the_method_is_the_one_the_manifest_writes():
    assert RULE_METHOD == MANIFEST_RULE_METHOD


def test_a_toy_rule_gives_the_softmax_by_hand():
    # Logits [0, ln 2, ln 3] -> [1, 2, 3] / 6. Features 1 and 3 are not read.
    (probs,) = rule_probs(toy_rule(), [[math.log(2), 99.0, math.log(3), -99.0]], 4)
    assert probs == pytest.approx([1 / 6, 2 / 6, 3 / 6], abs=1e-15)


def test_standardizes_before_the_logits():
    # z = (features - mean) / scale = [ln 2, ln 3] again.
    rule = toy_rule(mean=[1.0, -2.0], scale=[2.0, 0.5])
    (probs,) = rule_probs(rule, [[1.0 + 2 * math.log(2), 0.0, -2.0 + 0.5 * math.log(3), 0.0]], 4)
    assert probs == pytest.approx([1 / 6, 2 / 6, 3 / 6], abs=1e-15)


def test_large_logits_do_not_overflow():
    (probs,) = rule_probs(toy_rule(), [[1000.0, 0.0, 999.0, 0.0]], 4)
    assert probs == pytest.approx([0.0, 1 / (1 + math.exp(-1)), math.exp(-1) / (1 + math.exp(-1))], abs=1e-15)


BAD_RULES = [
    ("method", "probs = sigmoid(z)", "method"),
    ("featureIndices", [0], "length"),
    ("mean", [0.0], "length"),
    ("scale", [1.0, 1.0, 1.0], "length"),
    ("features", ["first"], "length"),
    ("coefficients", [[0.0, 0.0], [1.0, 0.0]], "length"),
    ("coefficients", [[0.0, 0.0], [1.0], [0.0, 1.0]], "length"),
    ("intercepts", [0.0, 0.0], "length"),
    ("scale", [1.0, 0.0], "scale"),
    ("scale", [1.0, -1.0], "scale"),
    # StandardScaler's scale_ is sqrt(var_), or 1 for a constant feature: never below about 2.2e-162.
    ("scale", [1.0, 5e-324], "scale"),
    ("classes", [1, "af", "other"], "classes"),
    ("classes", [None, "af", "other"], "classes"),
    ("mean", [10**400, 0.0], "finite"),
    ("mean", [0.0, float("nan")], "finite"),
    ("coefficients", [[0.0, 0.0], [float("inf"), 0.0], [0.0, 1.0]], "finite"),
    ("intercepts", [0.0, "1", 0.0], "finite"),
    ("featureIndices", [0, 4], "featureIndices"),
    ("featureIndices", [0, -1], "featureIndices"),
    ("featureIndices", [0, 1.5], "featureIndices"),
    ("featureIndices", [2, 2], "featureIndices"),
    ("classes", ["sinus", "af", "noise"], "classes"),
    ("classes", ["sinus", "af", "af"], "classes"),
]


@pytest.mark.parametrize(("key", "bad", "match"), BAD_RULES)
def test_a_malformed_rule_is_refused(key, bad, match):
    with pytest.raises(RuleError, match=match):
        check_rule(toy_rule(**{key: bad}), 4)


def test_a_rule_missing_a_key_is_refused():
    rule = toy_rule()
    del rule["intercepts"]
    with pytest.raises(RuleError, match="intercepts"):
        check_rule(rule, 4)


@pytest.mark.parametrize(
    "features",
    [
        [[]],
        [[0.0, 0.0, 0.0]],
        [[0.0, 0.0, 0.0, 0.0, 0.0]],
        [[0.0, float("nan"), 0.0, 0.0]],
        [[0.0, 0.0, float("inf"), 0.0]],
        [[0.0] * 4, [0.0] * 3],
    ],
)
def test_a_bad_feature_vector_is_refused(features):
    with pytest.raises(RuleError, match="feature"):
        rule_probs(toy_rule(), features, 4)


def test_matches_sklearn_predict_proba():
    pipeline, rule = fitted_rule()
    fixture = rule_fixture()
    features = np.asarray(fixture["features"])
    probs = rule_probs(rule, fixture["features"], fixture["inputs"]["features"][1])
    np.testing.assert_allclose(probs, pipeline.predict_proba(features), rtol=0, atol=1e-12)


def test_the_committed_fixture_is_the_reference_output():
    # The probabilities are recomputed from the fixture's own rule and inputs, so the check does not
    # depend on the solver refitting to the last bit on another machine.
    committed = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    probs = rule_probs(committed["rule"], committed["features"], committed["inputs"]["features"][1])
    np.testing.assert_allclose(committed["probs"], probs, rtol=0, atol=1e-15)
    fresh = rule_fixture()
    for key in ("inputs", "features"):
        assert committed[key] == fresh[key]
    assert committed["rule"]["features"] == fresh["rule"]["features"]


def test_a_reading_without_windows_has_no_rows():
    assert rule_probs(toy_rule(), [], 4) == []


def test_integral_float_indices_are_read_as_integers():
    # JSON gives JavaScript no way to tell 2.0 from 2, so both languages accept it.
    hand = [[math.log(2), 99.0, math.log(3), -99.0]]
    assert rule_probs(toy_rule(featureIndices=[0.0, 2.0]), hand, 4) == rule_probs(toy_rule(), hand, 4)


def test_integers_are_rounded_to_doubles_before_arithmetic():
    # 2^53 + 1 is not a double; JavaScript reads it as 2^53, so z is 0 in both languages, not 1.
    rule = toy_rule(mean=[2**53, 0.0], coefficients=[[0.0, 0.0], [1.0, 0.0], [0.0, 0.0]])
    (probs,) = rule_probs(rule, [[2**53 + 1, 0.0, 0.0, 0.0]], 4)
    assert probs == pytest.approx([1 / 3] * 3, abs=1e-15)


def test_a_window_whose_logits_overflow_is_refused():
    with pytest.raises(RuleError, match="overflow"):
        rule_probs(toy_rule(intercepts=[0.0, 1.7e308, 0.0]), [[1.7e308, 0.0, 0.0, 0.0]], 4)
    sunk = toy_rule(coefficients=[[1.0, 0.0]] * 3, intercepts=[-1.7e308] * 3)
    with pytest.raises(RuleError, match="overflow"):
        rule_probs(sunk, [[-1.7e308, 0.0, 0.0, 0.0]], 4)


def test_an_integer_feature_beyond_a_double_is_refused():
    with pytest.raises(RuleError, match="finite"):
        rule_probs(toy_rule(), [[10**400, 0.0, 0.0, 0.0]], 4)


def _wide(window):
    return [*window, *([7.0] * (len(RHYTHM_FEATURE_NAMES) - len(window)))]


def test_reads_only_the_prefix_of_cores_full_width_vector():
    window = [math.log(2), 99.0, math.log(3), -99.0]
    assert rule_probs(toy_rule(), [_wide(window)], 4) == rule_probs(toy_rule(), [window], 4)


def test_full_width_vector_with_a_non_finite_value_past_the_prefix_is_refused():
    window = _wide([math.log(2), 99.0, math.log(3), -99.0])
    window[-1] = math.nan
    with pytest.raises(RuleError, match="feature vector"):
        rule_probs(toy_rule(), [window], 4)


def test_a_rule_wider_than_core_is_refused():
    with pytest.raises(RuleError, match="core computes"):
        rule_probs(toy_rule(), [], len(RHYTHM_FEATURE_NAMES) + 1)
