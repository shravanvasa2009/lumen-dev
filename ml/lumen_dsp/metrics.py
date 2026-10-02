import math
from collections.abc import Sequence
from dataclasses import dataclass

from lumen_dsp.beats import js_round
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.median import median
from lumen_dsp.resample import ResampledSegment
from lumen_dsp.signals import dc_level

# Mirrors packages/core/src/reading-metrics.ts with the same loops in the same order on plain Python
# floats (§10.2 parity). A reading is one beat list per DSP-2 segment; no interval spans two segments.


@dataclass(frozen=True)
class MeasuredBeat:
    peak_s: float
    beat_class: str  # DSP-9: "not-a-beat", "artifact", "atypical", or "normal"
    long_pause: bool  # DSP-9 long pause on the interval ending at this beat
    amplitude: float  # DSP-8 peak minus onset level (the preceding minimum), morphology band
    intensity: float  # raw −R at the peak: the DSP-13 intensity (baseline) series
    dc: float  # DSP-3 DC level of −R at the peak; negative because −R is negative


@dataclass(frozen=True)
class Hrv:
    rmssd_ms: float | None
    sdnn_ms: float | None
    pnn50: float | None  # fraction of successive differences over 50 ms
    nn_intervals: int  # NN intervals left after the 20% filter


# Time in [start_s, end_s] not covered by any rejected span (overlaps counted once).
def clean_seconds(start_s: float, end_s: float, rejected_spans: Sequence[tuple[float, float]]) -> float:
    clipped = sorted(
        (max(span_start, start_s), min(span_end, end_s))
        for span_start, span_end in rejected_spans
        if min(span_end, end_s) > max(span_start, start_s)
    )
    lost_s = 0.0
    covered_to = start_s
    for span_start, span_end in clipped:
        if span_end <= covered_to:
            continue
        lost_s += span_end - max(span_start, covered_to)
        covered_to = span_end
    return end_s - start_s - lost_s


# DSP-10/13: amplitude, raw intensity, and DSP-3 DC per beat of one segment; raw is the 256 Hz −R.
def measure_beats(
    peaks_s: Sequence[float],
    beat_classes: Sequence[str],
    long_pauses: Sequence[bool],
    amplitudes: Sequence[float],
    raw: ResampledSegment,
) -> list[MeasuredBeat]:
    if not len(peaks_s) == len(beat_classes) == len(long_pauses) == len(amplitudes):
        raise ValueError("every beat needs a peak, a class, a long-pause flag, and an amplitude")
    shape_rate_hz = DSP_CONFIG["dsp2"]["shapeRateHz"]
    dc = dc_level(raw.values, shape_rate_hz)
    last = len(raw.values) - 1
    beats = []
    for peak_s, beat_class, long_pause, amplitude in zip(
        peaks_s, beat_classes, long_pauses, amplitudes, strict=True
    ):
        sample = min(last, max(0, js_round(peak_s * shape_rate_hz) - raw.first_index))
        beats.append(
            MeasuredBeat(
                peak_s=peak_s,
                beat_class=beat_class,
                long_pause=long_pause,
                amplitude=amplitude,
                intensity=float(raw.values[sample]),
                dc=float(dc[sample]),
            )
        )
    return beats


# DSP-10: perfusion index in percent, the median over normal beats of amplitude / |DC|; 30 clean s (§6.2).
def perfusion_index(segments: Sequence[Sequence[MeasuredBeat]], clean_s: float) -> float | None:
    if clean_s < DSP_CONFIG["dsp10"]["minCleanS"]:
        return None
    ratios = [
        100 * beat.amplitude / abs(beat.dc)
        for segment in segments
        for beat in segment
        if beat.beat_class == "normal"
    ]
    return median(ratios) if ratios else None


def beat_pairs(segment: Sequence[MeasuredBeat]) -> list[tuple[MeasuredBeat, MeasuredBeat]]:
    # Consecutive beats of one segment; "not a beat" candidates are left out (they are not beats).
    beats = [beat for beat in segment if beat.beat_class != "not-a-beat"]
    return list(zip(beats[:-1], beats[1:], strict=True))


# DSP-11: heart rate in bpm, 60 / the median interval between consecutive non-artifact beats; 15 clean s.
def heart_rate(segments: Sequence[Sequence[MeasuredBeat]], clean_s: float) -> float | None:
    if clean_s < DSP_CONFIG["dsp11"]["minCleanS"]:
        return None
    intervals_s = [
        later.peak_s - earlier.peak_s
        for segment in segments
        for earlier, later in beat_pairs(segment)
        if earlier.beat_class != "artifact" and later.beat_class != "artifact"
    ]
    return 60 / median(intervals_s) if intervals_s else None


def _nn_runs(segments: Sequence[Sequence[MeasuredBeat]]) -> list[list[float]]:
    # Runs of adjacent NN intervals (normal → normal, the second not ending a long pause); anything else
    # ends the run, so successive differences only pair intervals that share a beat.
    runs = []
    for segment in segments:
        run: list[float] = []
        for earlier, later in beat_pairs(segment):
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
    # The 20% filter: the reference is the median of up to `neighbours` NN intervals on each side in reading
    # order (before filtering, itself excluded). A dropped interval splits its run.
    dsp12 = DSP_CONFIG["dsp12"]
    neighbours, max_deviation = dsp12["neighbours"], dsp12["maxNeighbourDeviation"]
    every = [interval_s for run in runs for interval_s in run]
    kept = []
    position = 0
    for run in runs:
        current: list[float] = []
        for interval_s in run:
            reference = median(
                every[max(0, position - neighbours) : position]
                + every[position + 1 : position + 1 + neighbours]
            )
            position += 1
            if abs(interval_s - reference) > max_deviation * reference:
                if current:
                    kept.append(current)
                current = []
                continue
            current.append(interval_s)
        if current:
            kept.append(current)
    return kept


# DSP-12: RMSSD, SDNN, pNN50 from NN intervals; None unless the rhythm is sinus and the capture format runs
# at ≥ 60 fps. Each value is None below its own clean-data floor.
def hrv(
    segments: Sequence[Sequence[MeasuredBeat]], rhythm: str, capture_fps: float, clean_s: float
) -> Hrv | None:
    dsp12 = DSP_CONFIG["dsp12"]
    if rhythm != "sinus" or capture_fps < dsp12["minFps"]:
        return None
    runs = _filtered_runs(_nn_runs(segments))
    intervals_s = [interval_s for run in runs for interval_s in run]
    differences = [run[i + 1] - run[i] for run in runs for i in range(len(run) - 1)]

    enough = clean_s >= dsp12["rmssdMinCleanS"] and len(intervals_s) >= dsp12["rmssdMinIntervals"]
    squares = 0.0
    for difference in differences:
        squares += difference * difference
    with_differences = enough and len(differences) > 0
    rmssd_ms = 1000 * math.sqrt(squares / len(differences)) if with_differences else None
    over = sum(1 for difference in differences if abs(difference) > dsp12["pnnThresholdS"])
    pnn50 = over / len(differences) if with_differences else None

    sdnn_ms = None
    if enough and clean_s >= dsp12["sdnnMinCleanS"]:
        total = 0.0
        for interval_s in intervals_s:
            total += interval_s
        mean = total / len(intervals_s)
        deviations = 0.0
        for interval_s in intervals_s:
            deviations += (interval_s - mean) ** 2
        # Sample SD (n − 1) (ADR 0040).
        sdnn_ms = 1000 * math.sqrt(deviations / (len(intervals_s) - 1))
    return Hrv(rmssd_ms=rmssd_ms, sdnn_ms=sdnn_ms, pnn50=pnn50, nn_intervals=len(intervals_s))


# ML-6: diabetes-net's [1, 4] HR/HRV summary [HR bpm, RMSSD ms, SDNN ms, pNN50] by DSP-11 and DSP-12, as
# packages/core hrSummary. None values get the model's training median, not a fill here.
def hr_summary(
    segments: Sequence[Sequence[MeasuredBeat]], rhythm: str, capture_fps: float, clean_s: float
) -> list[float | None]:
    variability = hrv(segments, rhythm, capture_fps, clean_s)
    if variability is None:
        return [heart_rate(segments, clean_s), None, None, None]
    return [heart_rate(segments, clean_s), variability.rmssd_ms, variability.sdnn_ms, variability.pnn50]
