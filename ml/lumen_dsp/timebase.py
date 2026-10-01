from dataclasses import dataclass

import numpy as np

from lumen_dsp.config import DSP_CONFIG


@dataclass(frozen=True)
class Timebase:
    start_ns: int
    t_s: np.ndarray  # seconds from the first frame
    r: np.ndarray
    g: np.ndarray
    b: np.ndarray
    exposure_ns: np.ndarray
    median_frame_interval_s: float
    dropped_gap_starts: np.ndarray  # index of the frame before each dropped-frame gap


# DSP-1: capture-file columns (Appendix B) to seconds from capture start, with dropped-frame gaps.
def build_timebase(samples: dict, stats: dict) -> Timebase:
    t_ns = np.asarray(samples["tNs"], dtype=np.int64)
    if len(t_ns) < 2:
        raise ValueError(f"need at least 2 frames, got {len(t_ns)}")
    stat_t_ns = np.asarray(stats["tNs"], dtype=np.int64)
    if not np.array_equal(stat_t_ns, t_ns):
        raise ValueError("frame stats do not line up with samples")

    # Subtract in integer ns before scaling, as packages/core does (exact while tNs < 2^53).
    t_s = (t_ns - t_ns[0]) / 1e9
    intervals_s = np.diff(t_s)
    if np.any(intervals_s <= 0):
        raise ValueError("timestamps must strictly increase")
    median_s = float(np.median(intervals_s))
    dropped = np.flatnonzero(intervals_s > DSP_CONFIG["dsp1"]["droppedFrameGapRatio"] * median_s)
    return Timebase(
        start_ns=int(t_ns[0]),
        t_s=t_s,
        r=np.asarray(samples["r"], dtype=np.float64),
        g=np.asarray(samples["g"], dtype=np.float64),
        b=np.asarray(samples["b"], dtype=np.float64),
        exposure_ns=np.asarray(stats["exposureNs"], dtype=np.float64),
        median_frame_interval_s=median_s,
        dropped_gap_starts=dropped,
    )
