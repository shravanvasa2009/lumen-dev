from typing import NamedTuple

import numpy as np

# Spec §11.3: about 1% of intervals merged (missed beat), 0.5% split (extra detection), and 20-40% of
# premature beats dropped (pulse deficit: a weak premature beat leaves no pulse at the fingertip).
MERGE_RATE = 0.01
SPLIT_RATE = 0.005
DROP_FRACTION_RANGE = (0.2, 0.4)
# Where a false extra detection lands inside an interval. Not measured from data: a dicrotic notch or a
# motion spike falls somewhere mid-beat, so it is drawn uniformly from the middle of the interval.
SPLIT_POSITION_RANGE = (0.3, 0.7)


class AugmentedIntervals(NamedTuple):
    intervals_ms: np.ndarray
    premature: np.ndarray


def augment_intervals(
    intervals_ms: np.ndarray,
    premature: np.ndarray,
    rng: np.random.Generator,
    jitter_sd_ms: float,
    merge_rate: float = MERGE_RATE,
    split_rate: float = SPLIT_RATE,
    drop_fraction_range: tuple[float, float] = DROP_FRACTION_RANGE,
) -> AugmentedIntervals:
    intervals_ms = np.asarray(intervals_ms, dtype=float)
    premature = np.asarray(premature, dtype=bool)
    if intervals_ms.shape != premature.shape or intervals_ms.ndim != 1:
        raise ValueError("intervals_ms and premature must be 1-D and the same length")
    if jitter_sd_ms < 0:
        raise ValueError(f"jitter_sd_ms must be >= 0, got {jitter_sd_ms}")
    for name, rate in (("merge_rate", merge_rate), ("split_rate", split_rate)):
        if not 0 <= rate < 1:
            raise ValueError(f"{name} must be in [0, 1), got {rate}")
    low, high = drop_fraction_range
    if not 0 <= low <= high <= 1:
        raise ValueError(f"drop_fraction_range must satisfy 0 <= low <= high <= 1, got {drop_fraction_range}")

    # Work on beat times: premature[i] marks the beat that ends interval i, which is beat i + 1.
    times = np.concatenate([[0.0], np.cumsum(intervals_ms)])
    beat_premature = np.concatenate([[False], premature])

    # Deficit: one drop fraction per sequence, applied per beat so a short window with a single
    # premature beat can still lose it. The final beat has no following interval to merge into.
    drop_fraction = rng.uniform(low, high)
    droppable = beat_premature.copy()
    droppable[-1] = False
    keep = ~(droppable & (rng.random(len(times)) < drop_fraction))
    times, beat_premature = times[keep], beat_premature[keep]

    # Missed beat: removing an inner beat merges its two intervals. The first and last beats stay, so
    # the total duration is unchanged.
    missed = rng.random(len(times)) < merge_rate
    missed[[0, -1]] = False
    times, beat_premature = times[~missed], beat_premature[~missed]

    # Extra detection: a false beat inside an interval splits it in two.
    gaps = np.diff(times)
    split_at = np.flatnonzero(rng.random(len(gaps)) < split_rate)
    extra_times = times[split_at] + gaps[split_at] * rng.uniform(*SPLIT_POSITION_RANGE, size=len(split_at))
    times = np.concatenate([times, extra_times])
    beat_premature = np.concatenate([beat_premature, np.zeros(len(extra_times), dtype=bool)])

    times = times + rng.normal(0.0, jitter_sd_ms, size=len(times))
    # Sorting restores time order after inserting split beats, and after jitter swaps two beats a few
    # tens of ms apart; each beat keeps its own premature flag.
    order = np.argsort(times, kind="stable")
    times, beat_premature = times[order], beat_premature[order]
    return AugmentedIntervals(intervals_ms=np.diff(times), premature=beat_premature[1:])
