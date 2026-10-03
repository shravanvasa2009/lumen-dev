import json
import math

from lumen_dsp.beats import detect_beats, elgendi_peaks, elgendi_windows, js_round
from lumen_dsp.golden import morphology_segment
from tests.redteam.dsp7_refinement_cases import (
    CASES_PATH,
    MODEL_HZ,
    SHAPE_HZ,
    build_case,
    cases,
    detect_case,
    plateau_cases,
)

# Red team (§16) for PR #147 (ADR 0068): DSP-7 refines only at a local maximum of the 256 Hz band and
# drops a candidate refining to or before the previous peak. Mirrors the TypeScript side,
# packages/core/test/redteam/dsp7-refinement.test.ts; both read fixtures/dsp7-refinement-cases.json.

# The refinement climbs a slope at most half of W1 from its candidate (ADR 0068).
CLIMB_HALF = (elgendi_windows(SHAPE_HZ)[0] - 1) // 2
COMMITTED = json.loads(CASES_PATH.read_text(encoding="utf-8"))


def _gaussian(x: float, centre: float, width: float) -> float:
    return math.exp(-0.5 * ((x - centre) / width) ** 2)


def _band_pair(volume, seconds: int):
    def sampled(rate_hz: int):
        return morphology_segment([volume(k / rate_hz) for k in range(seconds * rate_hz)], rate_hz)

    return sampled(MODEL_HZ), sampled(SHAPE_HZ)


def _band_maxima_s(values) -> list[float]:
    # Parabolic vertices of the band's strict local maxima: where its peaks are, to within float error.
    maxima = []
    for k in range(1, len(values) - 1):
        before, at, after = values[k - 1], values[k], values[k + 1]
        if at >= before and at > after:
            maxima.append((k + 0.5 * (before - after) / (before - 2 * at + after)) / SHAPE_HZ)
    return maxima


def test_committed_cases_are_what_the_generator_builds():
    assert cases() == COMMITTED


def _is_refined_peak(values: list[float], index: float, centres: list[int]) -> bool:
    # Within half of W1 (plus the parabola's half sample) of a candidate, and either a local maximum of the
    # band moved at most half a sample by the parabola, or a sample the climb had to stop on exactly: a
    # segment end, or the climb limit with the band still rising.
    last = len(values) - 1

    def is_local_maximum(k: int) -> bool:
        return 0 < k < last and values[k] >= values[k - 1] and values[k] >= values[k + 1]

    return any(
        abs(index - centre) <= CLIMB_HALF + 0.5
        and any(
            (abs(index - sample) <= 0.5 and is_local_maximum(sample))
            or (index == sample and (sample in (0, last) or abs(sample - centre) == CLIMB_HALF))
            for sample in (math.floor(index), math.ceil(index))
        )
        for centre in centres
    )


def test_fuzzed_peaks_strictly_increase_and_are_peaks_of_the_band():
    for seed in range(1, 81):
        case = build_case(seed)
        peaks_s = detect_case(case)
        assert all(later > earlier for earlier, later in zip(peaks_s[:-1], peaks_s[1:], strict=False)), seed
        first = case["firstModelIndex"]
        centres = [
            js_round((first + peak) / MODEL_HZ * SHAPE_HZ) - 4 * first
            for peak in elgendi_peaks(case["model"], MODEL_HZ)
        ]
        for peak_s in peaks_s:
            assert _is_refined_peak(case["shape"], peak_s * SHAPE_HZ - 4 * first, centres), (seed, peak_s)


def test_a_clipped_peak_is_refined_to_a_point_on_its_flat_top():
    # The top is every sample equal to the maximum; the refined time must lie on it, or within the half
    # sample a parabola may move when the top is one sample. Exact plateaus cannot come through the 0.5–8 Hz
    # band, so this checks only that nothing leaves the top, not where on it the time lands.
    for case in plateau_cases():
        (peak_s,) = detect_case(case)
        top = [j for j, value in enumerate(case["shape"]) if value == max(case["shape"])]
        assert top[0] - 0.5 <= peak_s * SHAPE_HZ <= top[-1] + 0.5, (case["centre"], case["clip"])


def test_premature_beats_0_25_to_0_35_s_after_a_beat_are_never_dropped_as_duplicates():
    # Full-height premature beats (σ 30–60 ms) 0.25–0.35 s after the beat at 5 s, in a 60 bpm rhythm.
    for sigma_s in (0.03, 0.04, 0.06):
        for coupling_s in (0.25, 0.28, 0.3, 0.32, 0.35):
            beats_s = [float(t) for t in range(1, 11)] + [5 + coupling_s]

            def volume(t_s: float, beats_s=beats_s, sigma_s=sigma_s) -> float:
                return sum(_gaussian(t_s, beat_s, sigma_s) for beat_s in beats_s)

            model, shape = _band_pair(volume, 12)
            peaks_s = [beat.peak_s for beat in detect_beats(model, shape)]
            assert len(peaks_s) == len(elgendi_peaks(model.values, MODEL_HZ)) == 11, (sigma_s, coupling_s)
            assert min(abs(peak_s - 5 - coupling_s) for peak_s in peaks_s) < 0.001, (sigma_s, coupling_s)


def test_a_candidate_on_the_falling_side_of_a_dicrotic_lobe_is_refined_to_the_lobe_maximum():
    # Failed at 19ea89b. 60 bpm, systolic wave σ 30 ms, dicrotic wave 0.6× at +0.3 s with σ 0.2 s, 20 s, no
    # noise. Elgendi opens a block on the falling side of the dicrotic lobe, 27 ms (8.6 samples) after its
    # maximum, so the ±4-sample window maximum is the window's first sample. 19ea89b kept that sample,
    # reporting each such beat (DSP-9 "atypical", so it enters DSP-11 and DSP-15) 11–18 ms after the lobe
    # maximum. Every reported peak must be a peak of the band, within 1 ms of one of its local maxima.
    def volume(t_s: float) -> float:
        total = 0.0
        for beat in range(-1, 21):
            total += _gaussian(t_s, beat, 0.03) + 0.6 * _gaussian(t_s, beat + 0.3, 0.2)
        return total

    model, shape = _band_pair(volume, 20)
    maxima_s = _band_maxima_s(shape.values)
    errors_ms = [
        1000 * min(abs(beat.peak_s - maximum_s) for maximum_s in maxima_s)
        for beat in detect_beats(model, shape)
        if 1 < beat.peak_s < 19
    ]
    assert max(errors_ms) < 1.0
