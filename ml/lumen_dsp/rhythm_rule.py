import math
from collections.abc import Sequence

# Mirrors packages/core/src/rhythm-rule.ts: §11.1's logistic rhythm rule, from the `rule` block of the
# rhythm-logistic manifest entry, with the same loops in the same order on plain Python floats (§10.2).

# export.write_manifest writes this formula; any other method would need other math here and in the app.
RULE_METHOD = "probs = softmax(coefficients · z + intercepts), z = (features[featureIndices] − mean) / scale"
RHYTHM_CLASSES = ("sinus", "af", "other")


class RuleError(ValueError):
    pass


def _finite(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _numbers(values, key: str, length: int) -> list[float]:
    if not isinstance(values, list) or len(values) != length:
        raise RuleError(f"rule {key} has the wrong length (need {length})")
    if not all(_finite(value) for value in values):
        raise RuleError(f"rule {key} has a value that is not a finite number")
    return values


def check_rule(rule: dict, feature_count: int) -> None:
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
    indices = rule["featureIndices"]
    if not isinstance(indices, list) or len(indices) == 0:
        raise RuleError("rule featureIndices has the wrong length (need at least 1)")
    if (
        not all(isinstance(index, int) and not isinstance(index, bool) for index in indices)
        or len(set(indices)) != len(indices)
        or not all(0 <= index < feature_count for index in indices)
    ):
        raise RuleError(f"rule featureIndices {indices} must be distinct integers below {feature_count}")
    columns = len(indices)
    if not isinstance(rule["features"], list) or len(rule["features"]) != columns:
        raise RuleError(f"rule features has the wrong length (need {columns})")
    _numbers(rule["mean"], "mean", columns)
    if not all(scale > 0 for scale in _numbers(rule["scale"], "scale", columns)):
        raise RuleError("rule scale must be > 0")
    classes = rule["classes"]
    if not isinstance(classes, list) or sorted(classes) != sorted(RHYTHM_CLASSES):
        raise RuleError(f"rule classes {classes} must be {list(RHYTHM_CLASSES)} in some order")
    coefficients = rule["coefficients"]
    if not isinstance(coefficients, list) or len(coefficients) != len(classes):
        raise RuleError(f"rule coefficients has the wrong length (need {len(classes)} rows)")
    for row in coefficients:
        _numbers(row, "coefficients", columns)
    _numbers(rule["intercepts"], "intercepts", len(classes))


def rule_probs(rule: dict, features: Sequence[Sequence[float]], feature_count: int) -> list[list[float]]:
    # Per-window probabilities, in the rule's `classes` order.
    check_rule(rule, feature_count)
    for vector in features:
        if len(vector) != feature_count or not all(_finite(value) for value in vector):
            raise RuleError(f"each feature vector needs {feature_count} finite numbers")
    indices, mean, scale = rule["featureIndices"], rule["mean"], rule["scale"]
    probs = []
    for vector in features:
        z = [(vector[index] - mean[k]) / scale[k] for k, index in enumerate(indices)]
        logits = []
        for row, intercept in zip(rule["coefficients"], rule["intercepts"], strict=True):
            logit = intercept
            for weight, value in zip(row, z, strict=True):
                logit += weight * value
            logits.append(logit)
        # Shifting by the largest logit leaves the softmax unchanged and keeps exp() from overflowing.
        top = max(logits)
        exps = [math.exp(logit - top) for logit in logits]
        total = sum(exps)
        probs.append([value / total for value in exps])
    return probs
