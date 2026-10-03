import json
import math
import time

import pytest

from lumen_dsp.rhythm_rule import RuleError, rule_probs
from tests.redteam.rule_cases import CASES_PATH, DSP15_FEATURES, HAND_WINDOW, cases, fixture_rule, toy_rule

# Each language is held to half the §10.2 parity tolerance against the exact reference, so the two agree
# within 1e-9 of each other.
REFERENCE_TOLERANCE = 5e-10
COMMITTED = json.loads(CASES_PATH.read_text(encoding="utf-8"))
TIMED_WINDOWS = 10_000
# A reading has tens of windows; 10,000 is a stress far beyond any capture, so this only guards against
# accidental quadratic work.
TIMED_BUDGET_S = 2.0


def test_the_committed_cases_are_the_generated_ones():
    assert COMMITTED == json.loads(json.dumps(cases(), ensure_ascii=False))


@pytest.mark.parametrize("case", COMMITTED, ids=[case["name"] for case in COMMITTED])
def test_adversarial_rule_input(case):
    rule, features, feature_count = case["rule"], case["features"], case["featureCount"]
    if case["expect"] == "refuse":
        with pytest.raises(RuleError):
            rule_probs(rule, features, feature_count)
        return
    if case["expect"] == "finiteOrRefuse":
        try:
            rows = rule_probs(rule, features, feature_count)
        except RuleError:
            return
        for row in rows:
            assert all(math.isfinite(value) for value in row), row
            assert sum(row) == pytest.approx(1, abs=1e-12)
        return
    rows = rule_probs(rule, features, feature_count)
    assert len(rows) == len(case["probs"])
    for row, expected in zip(rows, case["probs"], strict=True):
        assert row == pytest.approx(expected, abs=REFERENCE_TOLERANCE)


# ADR 0024 makes every DSP-15 feature finite and Rhythm-Net reads all eight, so a non-finite value anywhere
# means an upstream fault; the rule refuses it rather than quietly ignoring the columns it does not read.
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_a_non_finite_value_in_an_unused_position_is_refused(bad):
    vector = [0.0] * DSP15_FEATURES
    vector[7] = bad
    with pytest.raises(RuleError, match="finite"):
        rule_probs(fixture_rule(), [vector], DSP15_FEATURES)


def test_scores_10000_windows_in_budget():
    start = time.perf_counter()
    rows = rule_probs(toy_rule(), [HAND_WINDOW] * TIMED_WINDOWS, 4)
    elapsed = time.perf_counter() - start
    print(f"python rule_probs: {TIMED_WINDOWS} windows in {elapsed * 1000:.1f} ms")
    assert len(rows) == TIMED_WINDOWS
    assert elapsed < TIMED_BUDGET_S
