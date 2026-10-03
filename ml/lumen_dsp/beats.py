import math
from collections.abc import Sequence
from dataclasses import dataclass

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.resample import ResampledSegment

# Mirrors packages/core/src/beats.ts with the same loops in the same order on plain Python floats, so both
# sides make every comparison on the same doubles (§10.2 parity).


@dataclass(frozen=True)
class DetectedBeat:
    # Times are seconds from capture start (DSP-1); amplitudes are in morphology-band signal units.
    peak_s: float
    # None when nothing rises between the preceding minimum and the peak, or when the foot was not observed
    # (the upstroke began before the segment); DSP-9 then keeps the beat out of its references.
    onset_s: float | None
    max_upslope: float  # per second, between the preceding minimum and the peak (DSP-9 "not a beat")
    amplitude: float  # peak minus the preceding minimum


@dataclass(frozen=True)
class Upstroke:
    onset_index: float  # fractional sample index
    foot_index: int  # the preceding minimum
    max_upslope: float  # per sample


def js_round(x: float) -> int:
    # JavaScript Math.round: the nearest integer, halves toward +inf (Python's round goes to even).
    floor = math.floor(x)
    return floor + 1 if x - floor >= 0.5 else floor


# DSP-7: Elgendi W1 and W2 in samples, each rounded to the nearest odd count so the window centres.
def elgendi_windows(rate_hz: float) -> tuple[int, int]:
    def nearest_odd(samples: float) -> int:
        return 2 * js_round((samples - 1) / 2) + 1

    dsp7 = DSP_CONFIG["dsp7"]
    return nearest_odd(dsp7["peakWindowS"] * rate_hz), nearest_odd(dsp7["beatWindowS"] * rate_hz)


def _centered_mean(squared: list[float], width: int) -> list[float]:
    # Samples outside the signal count as zero and the sum is still divided by the full width.
    half = (width - 1) // 2
    means = []
    for n in range(len(squared)):
        total = 0.0
        for k in range(max(0, n - half), min(len(squared) - 1, n + half) + 1):
            total += squared[k]
        means.append(total / width)
    return means


# DSP-7: Elgendi et al. 2013 peak indices on a morphology-band signal, as published.
def elgendi_peaks(filtered: Sequence[float], rate_hz: float) -> list[int]:
    values = [float(value) for value in filtered]
    peak_samples, beat_samples = elgendi_windows(rate_hz)
    squared = [value * value if value > 0 else 0.0 for value in values]
    ma_peak = _centered_mean(squared, peak_samples)
    ma_beat = _centered_mean(squared, beat_samples)
    total = 0.0
    for value in squared:
        total += value
    offset = DSP_CONFIG["dsp7"]["beta"] * (total / len(squared))

    peaks = []
    n = 0
    while n < len(squared):
        if not ma_peak[n] > ma_beat[n] + offset:
            n += 1
            continue
        block_start = n
        while n < len(squared) and ma_peak[n] > ma_beat[n] + offset:
            n += 1
        # THR2: a block narrower than W1 cannot hold a systolic peak.
        if n - block_start < peak_samples:
            continue
        peak = block_start
        for k in range(block_start + 1, n):
            if values[k] > values[peak]:
                peak = k
        peaks.append(peak)
    return peaks


# DSP-8: tangent at the maximum upslope meets the horizontal line through the preceding minimum.
def upstroke(wave: Sequence[float], peak_index: int, search_start: int) -> Upstroke | None:
    foot_index = search_start
    for k in range(search_start + 1, peak_index + 1):
        if wave[k] < wave[foot_index]:
            foot_index = k
    # Central differences need a sample on each side, so at least one sample must lie strictly between.
    steepest = -1
    max_upslope = 0.0
    for k in range(foot_index + 1, peak_index):
        slope = (wave[k + 1] - wave[k - 1]) / 2
        if slope > max_upslope:
            max_upslope = slope
            steepest = k
    if steepest < 0:
        return None
    onset_index = steepest - (wave[steepest] - wave[foot_index]) / max_upslope
    return Upstroke(onset_index=onset_index, foot_index=foot_index, max_upslope=max_upslope)


def _parabolic_offset(before: float, at: float, after: float) -> float:
    # Vertex of the parabola through (−1, before), (0, at), (1, after), taken only at a local maximum, where
    # it lies within half a sample. A window maximum on a slope is not a peak of the band: its parabola's
    # vertex can be hundreds of samples away (VitalDB, order D.C_TASK-rhythm-windows-negative-interval).
    curvature = before - 2 * at + after
    return (0.5 * (before - after)) / curvature if at >= before and at >= after and curvature < 0 else 0.0


# DSP-7/8: beats from one resampled segment's morphology band at 64 Hz (model) and 256 Hz (shape).
def detect_beats(model: ResampledSegment, shape: ResampledSegment) -> list[DetectedBeat]:
    model_hz = DSP_CONFIG["dsp2"]["modelRateHz"]
    shape_hz = DSP_CONFIG["dsp2"]["shapeRateHz"]
    refine_half = js_round(DSP_CONFIG["dsp7"]["refineHalfWindowS"] * shape_hz)
    minimum_search = js_round(DSP_CONFIG["dsp8"]["minimumSearchS"] * shape_hz)
    wave = [float(value) for value in shape.values]
    last = len(wave) - 1

    def to_seconds(index: float) -> float:
        return (shape.first_index + index) / shape_hz

    beats = []
    previous_peak: int | None = None
    for model_peak in elgendi_peaks(model.values, model_hz):
        centre = js_round(((model.first_index + model_peak) / model_hz) * shape_hz) - shape.first_index
        start = max(0, centre - refine_half)
        stop = min(last, centre + refine_half)
        if start > stop:
            continue
        peak = start
        for k in range(start + 1, stop + 1):
            if wave[k] > wave[peak]:
                peak = k
        offset = _parabolic_offset(wave[peak - 1], wave[peak], wave[peak + 1]) if 0 < peak < last else 0.0
        peak_s = to_seconds(peak + offset)
        # Candidates one 64 Hz sample apart can share their window maximum: one peak found twice.
        if beats and peak_s <= beats[-1].peak_s:
            continue

        clipped_at_start = previous_peak is None and peak - minimum_search < 0
        found = upstroke(wave, peak, max(previous_peak or 0, peak - minimum_search))
        # A foot on the segment's first sample with the signal still rising there was not observed: the
        # upstroke began before the segment, so its tangent onset would be fabricated.
        foot_unseen = clipped_at_start and found is not None and found.foot_index == 0 and wave[1] > wave[0]
        beats.append(
            DetectedBeat(
                peak_s=peak_s,
                onset_s=to_seconds(found.onset_index) if found and not foot_unseen else None,
                max_upslope=found.max_upslope * shape_hz if found else 0.0,
                amplitude=wave[peak] - wave[found.foot_index] if found else 0.0,
            )
        )
        previous_peak = peak
    return beats
