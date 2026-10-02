# PROVISIONAL (ML-6). diabetes-net's HR/HRV summary [1, 4], written to ADR 0040's DSP-11/12 definitions
# until Track C ships `hr_summary` in lumen_dsp (order D.C_TASK-diabetes-shape-features). When it lands,
# train/diabetes_features.py imports that one instead and this file is deleted.
#
# Model input, not a displayed result: DSP-12's display floors (≥ 60 s and ≥ 50 NN intervals, SDNN
# ≥ 300 s) and its sinus/fps gate are not applied, because a 90 s Full Scan never reaches the SDNN floor.
# The NN count is returned so training can apply a floor; Track C's version decides the app's rule.
import math
from collections.abc import Sequence

import numpy as np

from lumen_dsp.beat_classes import ClassifiedBeat
from lumen_dsp.config import DSP_CONFIG

HR_SUMMARY_NAMES = ("hrBpm", "rmssdMs", "sdnnMs", "pnn50")
# DSP-12: an NN interval is dropped when it deviates > 20% from the median of ±5 neighbours.
NEIGHBOURS = 5
MAX_NEIGHBOUR_DEVIATION = 0.2


def _beat_pairs(beats: Sequence[ClassifiedBeat]) -> list[tuple[ClassifiedBeat, ClassifiedBeat]]:
    kept = [beat for beat in beats if beat.beat_class != "not-a-beat"]
    return list(zip(kept[:-1], kept[1:], strict=True))


def heart_rate_bpm(beats: Sequence[ClassifiedBeat]) -> float | None:
    # DSP-11 (ADR 0040): an artifact beat removes both intervals it touches; long pauses are kept.
    intervals_s = [
        later.peak_s - earlier.peak_s
        for earlier, later in _beat_pairs(beats)
        if earlier.beat_class != "artifact" and later.beat_class != "artifact"
    ]
    return 60 / float(np.median(intervals_s)) if intervals_s else None


def _nn_runs(beats: Sequence[ClassifiedBeat]) -> list[list[float]]:
    # Normal → normal, the later beat not ending a long pause; anything else ends the run, so successive
    # differences only pair intervals that share a beat.
    runs: list[list[float]] = []
    run: list[float] = []
    for earlier, later in _beat_pairs(beats):
        if earlier.beat_class == "normal" and later.beat_class == "normal" and not later.long_pause:
            run.append(later.peak_s - earlier.peak_s)
            continue
        if run:
            runs.append(run)
        run = []
    if run:
        runs.append(run)
    return runs


def _filtered_runs(runs: list[list[float]]) -> list[list[float]]:
    # The reference is taken before filtering, across runs, without the interval itself; a dropped interval
    # splits its run (ADR 0040).
    every = [interval_s for run in runs for interval_s in run]
    kept: list[list[float]] = []
    position = 0
    for run in runs:
        current: list[float] = []
        for interval_s in run:
            neighbours = (
                every[max(0, position - NEIGHBOURS) : position]
                + every[position + 1 : position + 1 + NEIGHBOURS]
            )
            position += 1
            reference = float(np.median(neighbours)) if neighbours else interval_s
            if abs(interval_s - reference) > MAX_NEIGHBOUR_DEVIATION * reference:
                if current:
                    kept.append(current)
                current = []
                continue
            current.append(interval_s)
        if current:
            kept.append(current)
    return kept


# Units in HR_SUMMARY_NAMES order: bpm, ms, ms, fraction. Also returns the NN count after the filter.
def hr_summary(beats: Sequence[ClassifiedBeat]) -> tuple[list[float | None], int]:
    runs = _filtered_runs(_nn_runs(beats))
    intervals_s = [interval_s for run in runs for interval_s in run]
    differences = [later - earlier for run in runs for earlier, later in zip(run[:-1], run[1:], strict=True)]
    rmssd_ms = pnn50 = sdnn_ms = None
    if differences:
        rmssd_ms = 1000 * math.sqrt(sum(d * d for d in differences) / len(differences))
        pnn_threshold_s = DSP_CONFIG["dsp15"]["pnnThresholdS"]
        pnn50 = sum(1 for d in differences if abs(d) > pnn_threshold_s) / len(differences)
    if len(intervals_s) >= 2:
        sdnn_ms = 1000 * float(np.std(intervals_s, ddof=1))
    return [heart_rate_bpm(beats), rmssd_ms, sdnn_ms, pnn50], len(intervals_s)
