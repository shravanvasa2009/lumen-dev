import json
import math
from decimal import Decimal, localcontext
from pathlib import Path

from lumen_dsp.rhythm import RHYTHM_FEATURE_NAMES
from lumen_dsp.rhythm_rule import RULE_METHOD

# Adversarial inputs for the §11.1 logistic rule, shared with packages/core/test/redteam/rhythm-rule.test.ts
# so TypeScript and Python are judged on the same JSON (§10.2). Expected probabilities come from exact
# decimal arithmetic on the same doubles, not from either implementation, so each language is checked
# against the reference and the two agree within twice the tolerance.
# Regenerate with: uv run python -m tests.redteam.rule_cases (from ml/), then npx prettier --write on the
# JSON; the committed-cases test compares parsed values, so formatting does not matter to it.

REPO = Path(__file__).resolve().parents[3]
CASES_PATH = REPO / "packages" / "core" / "test" / "redteam" / "fixtures" / "rhythm-rule-cases.json"
FIXTURE_RULE_PATH = REPO / "packages" / "core" / "test" / "fixtures" / "rhythm-logistic.json"

TOY_FEATURES = 4
DSP15_FEATURES = 8
# Core's full width since ADR 0079: the 8 DSP-15 features then the 7 rhythm v2 features.
CORE_FEATURES = len(RHYTHM_FEATURE_NAMES)
V2_FEATURES = CORE_FEATURES - DSP15_FEATURES
LARGEST_SAFE_INTEGER = 2**53
# Logits [0, ln 2, ln 3] -> [1, 2, 3] / 6; features 1 and 3 are not read.
HAND_WINDOW = [math.log(2), 99.0, math.log(3), -99.0]


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


def fixture_rule():
    return json.loads(FIXTURE_RULE_PATH.read_text(encoding="utf-8"))["rule"]


def reference_probs(rule, vector):
    # Exact on the doubles a correct implementation sees: every input is first rounded to a float.
    with localcontext() as context:
        context.prec = 80
        exact = [Decimal(float(value)) for value in vector]
        z = [
            (exact[int(index)] - Decimal(float(mean))) / Decimal(float(scale))
            for index, mean, scale in zip(rule["featureIndices"], rule["mean"], rule["scale"], strict=True)
        ]
        logits = [
            Decimal(float(intercept))
            + sum(Decimal(float(weight)) * value for weight, value in zip(row, z, strict=True))
            for row, intercept in zip(rule["coefficients"], rule["intercepts"], strict=True)
        ]
        top = max(logits)
        exps = [(logit - top).exp() for logit in logits]
        total = sum(exps)
        return [float(value / total) for value in exps]


def probs_case(name, rule, features, feature_count=TOY_FEATURES):
    rows = [reference_probs(rule, vector) for vector in features]
    return {
        "name": name,
        "featureCount": feature_count,
        "rule": rule,
        "features": features,
        "expect": "probs",
        "probs": rows,
    }


def refuse_case(name, rule, features=(HAND_WINDOW,), feature_count=TOY_FEATURES):
    return {
        "name": name,
        "featureCount": feature_count,
        "rule": rule,
        "features": list(features),
        "expect": "refuse",
    }


# The rule may refuse these or return probabilities, but never a non-finite one.
def finite_or_refuse_case(name, rule, features, feature_count=TOY_FEATURES):
    return {
        "name": name,
        "featureCount": feature_count,
        "rule": rule,
        "features": features,
        "expect": "finiteOrRefuse",
    }


def cases():
    fixture = fixture_rule()
    at_mean = [*fixture["mean"], 0.0, 0.0, 0.0, 0.0, 0.0]
    tiny = [1e-300, 1e-300]
    return [
        probs_case("fixture rule, every feature +1e300", fixture, [[1e300] * 8], DSP15_FEATURES),
        probs_case("fixture rule, every feature -1e300", fixture, [[-1e300] * 8], DSP15_FEATURES),
        probs_case(
            "fixture rule, features alternating ±1e300",
            fixture,
            [[1e300 * (-1) ** k for k in range(8)]],
            DSP15_FEATURES,
        ),
        probs_case(
            "fixture rule, every feature the smallest subnormal", fixture, [[5e-324] * 8], DSP15_FEATURES
        ),
        probs_case(
            "fixture rule, every feature minus the smallest normal",
            fixture,
            [[-2.2250738585072014e-308] * 8],
            DSP15_FEATURES,
        ),
        probs_case("fixture rule, each used feature exactly at its mean", fixture, [at_mean], DSP15_FEATURES),
        probs_case(
            "scale 1e-300 with features exactly at the mean",
            toy_rule(mean=[0.5, -0.5], scale=tiny),
            [[0.5, 0.0, -0.5, 0.0]],
        ),
        probs_case(
            "scale 1e-300 with features 1e-300 and 2e-300 from the mean",
            toy_rule(scale=tiny),
            [[1e-300, 0.0, 2e-300, 0.0]],
        ),
        probs_case(
            "scale 1e-300 with features 1 and 0.5 from the mean", toy_rule(scale=tiny), [[1.0, 0.0, 0.5, 0.0]]
        ),
        probs_case(
            "af and other tie exactly",
            toy_rule(coefficients=[[0.0, 0.0], [1.0, 0.0], [1.0, 0.0]]),
            [[math.log(2), 0.0, 7.0, 0.0]],
        ),
        probs_case("all three classes tie", toy_rule(coefficients=[[0.0, 0.0]] * 3), [HAND_WINDOW]),
        probs_case(
            "intercepts ±1e308 with sinus and af tied at the top",
            toy_rule(intercepts=[1e308, 1e308, -1e308]),
            [[0.0] * 4],
        ),
        probs_case(
            "intercepts ±1e308 with af on top", toy_rule(intercepts=[-1e308, 1e308, 0.0]), [[0.0] * 4]
        ),
        probs_case(
            "extra keys in the rule block",
            {**toy_rule(), "note": "x", "trainedOn": [1, 2], "nested": {"mean": [9.0, 9.0]}},
            [HAND_WINDOW],
        ),
        probs_case(
            "classes listed other, af, sinus",
            toy_rule(classes=["other", "af", "sinus"], coefficients=[[0.0, 1.0], [1.0, 0.0], [0.0, 0.0]]),
            [HAND_WINDOW],
        ),
        probs_case(
            "a __proto__ key beside a complete rule",
            {**toy_rule(), "__proto__": {"mean": [100.0, 100.0]}},
            [HAND_WINDOW],
        ),
        # JSON cannot tell 2.0 from 2 in JavaScript, so the only way both languages can agree is to accept it.
        probs_case(
            "featureIndices written as integral floats", toy_rule(featureIndices=[0.0, 2.0]), [HAND_WINDOW]
        ),
        # A JSON integer above 2^53 is a double in JavaScript; Python must see the same double.
        probs_case(
            "an integer feature and mean above 2^53",
            toy_rule(mean=[LARGEST_SAFE_INTEGER, 0]),
            [[LARGEST_SAFE_INTEGER + 1, 0, 0, 0]],
        ),
        probs_case("zero windows", toy_rule(), []),
        probs_case("one window", toy_rule(), [HAND_WINDOW]),
        refuse_case("string-typed means", toy_rule(mean=["0", "0"])),
        refuse_case("string-typed scales", toy_rule(scale=["1", "1"])),
        refuse_case("string-typed featureIndices", toy_rule(featureIndices=["0", "2"])),
        refuse_case("string-typed coefficients", toy_rule(coefficients=[["0", "0"], ["1", "0"], ["0", "1"]])),
        refuse_case("string-typed intercepts", toy_rule(intercepts=["0", "0", "0"])),
        refuse_case("boolean featureIndices", toy_rule(featureIndices=[True, False])),
        refuse_case("means nested one level too deep", toy_rule(mean=[[0.0], [0.0]])),
        refuse_case("featureIndices nested one level too deep", toy_rule(featureIndices=[[0], [2]])),
        refuse_case(
            "coefficients flattened to one row", toy_rule(coefficients=[0.0, 0.0, 1.0, 0.0, 0.0, 1.0])
        ),
        refuse_case(
            "coefficients nested one level too deep",
            toy_rule(coefficients=[[[0.0, 0.0]], [[1.0, 0.0]], [[0.0, 1.0]]]),
        ),
        refuse_case("intercepts nested one level too deep", toy_rule(intercepts=[[0.0], [0.0], [0.0]])),
        refuse_case("a feature vector nested one level too deep", toy_rule(), [[[0.0], [0.0], [0.0], [0.0]]]),
        refuse_case("af listed twice, sinus once, other missing", toy_rule(classes=["af", "sinus", "af"])),
        refuse_case("other listed twice, af missing", toy_rule(classes=["other", "other", "sinus"])),
        refuse_case("the same feature indexed twice", toy_rule(featureIndices=[0, 0])),
        refuse_case("a class name that is a number", toy_rule(classes=[1, "af", "sinus"])),
        refuse_case("a class name that is null", toy_rule(classes=[None, "af", "other"])),
        refuse_case("the smallest negative scale", toy_rule(scale=[1.0, -5e-324])),
        refuse_case("an integer mean too big for a double", toy_rule(mean=[10**400, 0.0])),
        refuse_case("an integer feature too big for a double", toy_rule(), [[10**400, 0.0, 0.0, 0.0]]),
        refuse_case(
            "a required key only under __proto__",
            {
                **{key: value for key, value in toy_rule().items() if key != "mean"},
                "__proto__": {"mean": [0.0, 0.0]},
            },
        ),
        finite_or_refuse_case(
            "subnormal scale 5e-324 with a feature 1 from the mean",
            toy_rule(scale=[5e-324, 1.0]),
            [[1.0, 0.0, 0.0, 0.0]],
        ),
        finite_or_refuse_case(
            "scale 1e-300 with a feature 1e10 from the mean",
            toy_rule(scale=[1e-300, 1.0]),
            [[1e10, 0.0, 0.0, 0.0]],
        ),
        finite_or_refuse_case("fixture rule, every feature 1e308", fixture, [[1e308] * 8], DSP15_FEATURES),
        finite_or_refuse_case(
            "intercept 1.7e308 plus a 1.7e308 coefficient·z",
            toy_rule(intercepts=[0.0, 1.7e308, 0.0]),
            [[1.7e308, 0.0, 0.0, 0.0]],
        ),
        finite_or_refuse_case(
            "every logit overflows to −∞",
            toy_rule(coefficients=[[1.0, 0.0]] * 3, intercepts=[-1.7e308] * 3),
            [[-1.7e308, 0.0, 0.0, 0.0]],
        ),
        *width_cases(),
    ]


def width_cases():
    # ADR 0079: rules ship 15 wide, and a v1 (8-wide) entry reads the prefix of core's 15-wide vector.
    fixture = fixture_rule()
    at_mean = [*fixture["mean"], 0.0, 0.0, 0.0, 0.0, 0.0]
    v2_extremes = [1e308 * (-1) ** k for k in range(V2_FEATURES)]
    v2_reader = toy_rule(features=["medianAbsDiffNorm", "rrLag2Autocorr"], featureIndices=[8, 14])
    return [
        probs_case(
            "fixture rule at its shipped width 15, features alternating ±1e300",
            fixture,
            [[1e300 * (-1) ** k for k in range(CORE_FEATURES)]],
            CORE_FEATURES,
        ),
        probs_case(
            "fixture rule at width 15, v1 columns at the mean, v2 columns ±1e308",
            fixture,
            [[*at_mean, *v2_extremes]],
            CORE_FEATURES,
        ),
        probs_case(
            "v1 entry (8 wide) reads the prefix of a 15-wide vector with v2 columns ±1e308",
            fixture,
            [[*at_mean, *v2_extremes]],
            DSP15_FEATURES,
        ),
        probs_case(
            "v1 entry (8 wide) scores an 8-wide and a 15-wide window in one call",
            fixture,
            [[1.0] * DSP15_FEATURES, [1.0] * DSP15_FEATURES + [-5.0] * V2_FEATURES],
            DSP15_FEATURES,
        ),
        probs_case(
            "a rule that reads only v2 columns 8 and 14",
            v2_reader,
            [[99.0] * DSP15_FEATURES + [0.7, 0, 0, 0, 0, 0, 1.3]],
            CORE_FEATURES,
        ),
        refuse_case(
            "a v1 entry (8 wide) indexing v2 column 8",
            toy_rule(featureIndices=[0, 8]),
            [[0.0] * CORE_FEATURES],
            DSP15_FEATURES,
        ),
        refuse_case(
            "index 15 at width 15", toy_rule(featureIndices=[0, 15]), [[0.0] * CORE_FEATURES], CORE_FEATURES
        ),
        refuse_case("an entry wider than core (16)", toy_rule(), [[0.0] * 16], CORE_FEATURES + 1),
        refuse_case("an 8-wide vector for a 15-wide entry", fixture, [[0.0] * DSP15_FEATURES], CORE_FEATURES),
        refuse_case("a 9-wide vector for a v1 entry", fixture, [[0.0] * 9], DSP15_FEATURES),
        refuse_case("a 14-wide vector for a v1 entry", fixture, [[0.0] * 14], DSP15_FEATURES),
        refuse_case("a 16-wide vector for a 15-wide entry", fixture, [[0.0] * 16], CORE_FEATURES),
        refuse_case(
            "a 15-wide window then a 9-wide one for a v1 entry",
            fixture,
            [[0.0] * CORE_FEATURES, [0.0] * 9],
            DSP15_FEATURES,
        ),
        finite_or_refuse_case(
            "fixture rule at width 15, every feature 1e308", fixture, [[1e308] * CORE_FEATURES], CORE_FEATURES
        ),
    ]


def write_cases() -> None:
    CASES_PATH.write_text(json.dumps(cases(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    write_cases()
