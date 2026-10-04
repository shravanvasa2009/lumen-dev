import math
import sys
from collections.abc import Sequence

from lumen_dsp.rhythm import RHYTHM_FEATURE_NAMES

# Mirrors packages/core/src/rhythm-rule.ts: §11.1's logistic rhythm rule, from the `rule` block of the
# rhythm-logistic manifest entry, with the same loops in the same order on plain Python floats (§10.2).

# export.write_manifest writes this formula; any other method would need other math here and in the app.
RULE_METHOD = "probs = softmax(coefficients · z + intercepts), z = (features[featureIndices] − mean) / scale"
RHYTHM_CLASSES = ("sinus", "af", "other")
# The smallest normal double. write_manifest copies StandardScaler's scale_, which is sqrt(var_) (at least
# about 2.2e-162) or 1 for a constant feature, so only a hand-edited manifest has a smaller scale, and a
# subnormal one overflows z for almost any feature.
SMALLEST_NORMAL = sys.float_info.min


class RuleError(ValueError):
    pass


def _double(value) -> float | None:
    # JSON numbers are doubles in JavaScript, so every number is rounded to one before any arithmetic:
    # 2^53 + 1 becomes 2^53 here too, and an integer beyond the double range is not a finite number.
    if not isinstance(value, int | float) or isinstance(value, bool):
        return None
    try:
        double = float(value)
    except OverflowError:
        return None
    return double if math.isfinite(double) else None


def _doubles(values, message: str) -> list[float]:
    doubles = [_double(value) for value in values]
    if None in doubles:
        raise RuleError(message)
    return doubles


def _numbers(values, key: str, length: int) -> list[float]:
    if not isinstance(values, list) or len(values) != length:
        raise RuleError(f"rule {key} has the wrong length (need {length})")
    return _doubles(values, f"rule {key} has a value that is not a finite number")


def _index(value, feature_count: int) -> int | None:
    # JSON gives JavaScript no way to tell 2.0 from 2, so an integral float is an index too.
    double = _double(value)
    if double is None or not double.is_integer() or not 0 <= double < feature_count:
        return None
    return int(double)


def check_rule(rule: dict, feature_count: int) -> dict:
    # The rule with every number as a double and every index as an int, for rule_probs.
    missing = [
        key
        for key in (
            "method",
            "features",
            "featureIndices",
            "mean",
            "scale",
            "classes",
            "coefficients",
            "intercepts",
        )
        if key not in rule
    ]
    if missing:
        raise RuleError(f"rule is missing {missing}")
    if rule["method"] != RULE_METHOD:
        raise RuleError(f"rule method {rule['method']!r} is not {RULE_METHOD!r}")
    listed = rule["featureIndices"]
    if not isinstance(listed, list) or len(listed) == 0:
        raise RuleError("rule featureIndices has the wrong length (need at least 1)")
    indices = [_index(index, feature_count) for index in listed]
    if None in indices or len(set(indices)) != len(indices):
        raise RuleError(f"rule featureIndices {listed} must be distinct integers below {feature_count}")
    columns = len(indices)
    if not isinstance(rule["features"], list) or len(rule["features"]) != columns:
        raise RuleError(f"rule features has the wrong length (need {columns})")
    mean = _numbers(rule["mean"], "mean", columns)
    scale = _numbers(rule["scale"], "scale", columns)
    if not all(value >= SMALLEST_NORMAL for value in scale):
        raise RuleError(f"rule scale must be a normal positive number (at least {SMALLEST_NORMAL})")
    classes = rule["classes"]
    if (
        not isinstance(classes, list)
        or not all(isinstance(name, str) for name in classes)
        or sorted(classes) != sorted(RHYTHM_CLASSES)
    ):
        raise RuleError(f"rule classes {classes} must be {list(RHYTHM_CLASSES)} in some order")
    coefficients = rule["coefficients"]
    if not isinstance(coefficients, list) or len(coefficients) != len(classes):
        raise RuleError(f"rule coefficients has the wrong length (need {len(classes)} rows)")
    return {
        "featureIndices": indices,
        "mean": mean,
        "scale": scale,
        "classes": classes,
        "coefficients": [_numbers(row, "coefficients", columns) for row in coefficients],
        "intercepts": _numbers(rule["intercepts"], "intercepts", len(classes)),
    }


def rule_probs(rule: dict, features: Sequence[Sequence[float]], feature_count: int) -> list[list[float]]:
    # Per-window probabilities, in the rule's `classes` order.
    checked = check_rule(rule, feature_count)
    # As in rhythm-rule.ts: the rule's own width or core's full width, every value finite, read or not; the
    # rule reads its prefix, so a v1 rule keeps working on the wider v2 vector.
    if feature_count > len(RHYTHM_FEATURE_NAMES):
        raise RuleError(
            f"the rule asks for {feature_count} features; core computes {len(RHYTHM_FEATURE_NAMES)}"
        )
    widths = (feature_count, len(RHYTHM_FEATURE_NAMES))
    message = f"each feature vector needs {' or '.join(str(width) for width in widths)} finite numbers"
    vectors = []
    for vector in features:
        if not isinstance(vector, Sequence) or isinstance(vector, str) or len(vector) not in widths:
            raise RuleError(message)
        vectors.append(_doubles(vector, message)[:feature_count])
    indices, mean, scale = checked["featureIndices"], checked["mean"], checked["scale"]
    probs = []
    for vector in vectors:
        z = [(vector[index] - mean[k]) / scale[k] for k, index in enumerate(indices)]
        logits = []
        for row, intercept in zip(checked["coefficients"], checked["intercepts"], strict=True):
            logit = intercept
            for weight, value in zip(row, z, strict=True):
                logit += weight * value
            logits.append(logit)
        # An overflowed logit makes logit - top inf - inf = nan. A window that far outside the training
        # data has no meaningful probability, so it is refused rather than given a saturated one.
        if not all(math.isfinite(logit) for logit in logits):
            raise RuleError("a feature vector overflows the rule logits to a non-finite number")
        # Shifting by the largest logit leaves the softmax unchanged and keeps exp() from overflowing.
        top = max(logits)
        exps = [math.exp(logit - top) for logit in logits]
        total = sum(exps)
        probs.append([value / total for value in exps])
    return probs
