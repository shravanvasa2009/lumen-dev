import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.signal import welch

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.metrics import MeasuredBeat
from lumen_dsp.resample import ResampledSegment

# Mirrors packages/core/src/breathing.ts (§10.2 parity). The three respiratory modulations follow Karlen
# et al. 2013 (IEEE TBME 60(7):1946–1953, doi:10.1109/TBME.2013.2246160): intensity at each peak, pulse
# amplitude, and pulse interval.

KINDS = ("intensity", "amplitude", "interval")


@dataclass(frozen=True)
class WelchSpectrum:
    frequencies_hz: np.ndarray
    psd: np.ndarray  # per Hz of the series' units squared
    segments: int


@dataclass(frozen=True)
class BreathingRate:
    rate_brpm: float | None  # the mean of the three estimates when they agree within 4 br/min
    intensity_brpm: float | None
    amplitude_brpm: float | None
    interval_brpm: float | None


# DSP-13: scipy.signal.welch with the dsp13 parameters
# (https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.welch.html).
def welch_psd(series) -> WelchSpectrum:
    dsp13 = DSP_CONFIG["dsp13"]
    size, overlap = dsp13["welchSegmentSamples"], dsp13["welchOverlapSamples"]
    if len(series) < size:
        raise ValueError(f"Welch needs {size} samples, got {len(series)}")
    frequencies_hz, psd = welch(
        np.asarray(series, dtype=float),
        fs=dsp13["seriesRateHz"],
        window="hann",
        nperseg=size,
        noverlap=overlap,
        nfft=dsp13["welchFftSamples"],
        detrend="linear",
        return_onesided=True,
        scaling="density",
        average="mean",
    )
    return WelchSpectrum(
        frequencies_hz=frequencies_hz, psd=psd, segments=(len(series) - overlap) // (size - overlap)
    )


def _on_grid(times_s: list[float], values: list[float]) -> ResampledSegment | None:
    # Linear interpolation onto k / rate between the first and last point, same formula as the TypeScript.
    rate_hz = DSP_CONFIG["dsp13"]["seriesRateHz"]
    if len(times_s) < 2:
        return None
    first_index = math.ceil(times_s[0] * rate_hz)
    last_index = math.floor(times_s[-1] * rate_hz)
    if last_index < first_index:
        return None
    grid = []
    j = 0
    for k in range(last_index - first_index + 1):
        t_s = (first_index + k) / rate_hz
        while j < len(times_s) - 2 and times_s[j + 1] < t_s:
            j += 1
        slope = (values[j + 1] - values[j]) / (times_s[j + 1] - times_s[j])
        grid.append(values[j] + (t_s - times_s[j]) * slope)
    return ResampledSegment(first_index=first_index, values=np.array(grid))


def _runs(segment: Sequence[MeasuredBeat]) -> list[list[MeasuredBeat]]:
    # Runs of consecutive non-artifact beats within one segment; "not a beat" candidates are left out.
    runs: list[list[MeasuredBeat]] = [[]]
    for beat in segment:
        if beat.beat_class == "not-a-beat":
            continue
        if beat.beat_class == "artifact":
            runs.append([])
        else:
            runs[-1].append(beat)
    return [run for run in runs if run]


# DSP-13: intensity, amplitude, and interval series at 4 Hz per run of non-artifact beats. Points come
# from normal beats only; an interval point needs a normal beat at both ends and no long pause.
def breathing_series(segments: Sequence[Sequence[MeasuredBeat]]) -> dict[str, list[ResampledSegment]]:
    series: dict[str, list[ResampledSegment]] = {kind: [] for kind in KINDS}
    for run in (run for segment in segments for run in _runs(segment)):
        normal = [beat for beat in run if beat.beat_class == "normal"]
        peaks_s = [beat.peak_s for beat in normal]
        ends = [
            (later.peak_s, later.peak_s - earlier.peak_s)
            for earlier, later in zip(run[:-1], run[1:], strict=True)
            if earlier.beat_class == "normal" and later.beat_class == "normal" and not later.long_pause
        ]
        grids = {
            "intensity": _on_grid(peaks_s, [beat.intensity for beat in normal]),
            "amplitude": _on_grid(peaks_s, [beat.amplitude for beat in normal]),
            "interval": _on_grid([t_s for t_s, _ in ends], [interval_s for _, interval_s in ends]),
        }
        for kind in KINDS:
            if grids[kind] is not None:
                series[kind].append(grids[kind])
    return series


def _peak_brpm(runs: list[ResampledSegment]) -> float | None:
    # Peak of the segment-weighted mean Welch PSD over every run long enough for one segment, in br/min.
    dsp13 = DSP_CONFIG["dsp13"]
    low_hz, high_hz = dsp13["bandHz"]
    spectra = [welch_psd(run.values) for run in runs if len(run.values) >= dsp13["welchSegmentSamples"]]
    if not spectra:
        return None
    segments = 0
    for spectrum in spectra:
        segments += spectrum.segments
    frequencies_hz = spectra[0].frequencies_hz
    peak, peak_power = -1, -math.inf
    for index, frequency_hz in enumerate(frequencies_hz):
        if frequency_hz < low_hz or frequency_hz > high_hz:
            continue
        power = 0.0
        for spectrum in spectra:
            power += float(spectrum.psd[index]) * spectrum.segments / segments
        if power > peak_power:
            peak, peak_power = index, power
    return 60 * float(frequencies_hz[peak])


# DSP-13: breathing rate in br/min from three modulations, fused only when they agree; None < 60 clean s.
def breathing_rate(segments: Sequence[Sequence[MeasuredBeat]], clean_s: float) -> BreathingRate | None:
    if not clean_s >= DSP_CONFIG["dsp13"]["minCleanS"]:  # NaN fails
        return None
    return breathing_estimates(segments)


# DSP-13 without its clean-seconds floor (ADR 0104): the three estimates and their fused rate.
def breathing_estimates(segments: Sequence[Sequence[MeasuredBeat]]) -> BreathingRate:
    dsp13 = DSP_CONFIG["dsp13"]
    series = breathing_series(segments)
    intensity, amplitude, interval = (_peak_brpm(series[kind]) for kind in KINDS)
    rate = None
    if intensity is not None and amplitude is not None and interval is not None:
        estimates = [intensity, amplitude, interval]
        if max(estimates) - min(estimates) <= dsp13["maxSpreadBrpm"]:
            rate = (intensity + amplitude + interval) / 3
    return BreathingRate(
        rate_brpm=rate, intensity_brpm=intensity, amplitude_brpm=amplitude, interval_brpm=interval
    )
