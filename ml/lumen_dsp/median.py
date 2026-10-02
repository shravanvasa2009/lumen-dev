import math
from collections.abc import Sequence


def median(values: Sequence[float]) -> float:
    # packages/core/src/median.ts: the mean of the two middle values for an even count; NaN for no values.
    ordered = sorted(values)
    if not ordered:
        return math.nan
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 == 1 else (ordered[middle - 1] + ordered[middle]) / 2
