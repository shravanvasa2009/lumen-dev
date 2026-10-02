import dataclasses
import math

import numpy as np
import pytest

from lumen_dsp.beat_classes import RejectedSpan, classify_beats
from lumen_dsp.beats import DetectedBeat, detect_beats
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.resample import ResampledSegment
from lumen_dsp.golden import morphology_segment, ppg_wave, regular_beats, with_premature_beats
from lumen_dsp.tests.synthetic import park_miller_uniforms

MODEL_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
SHAPE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]
RR_S = 60 / 72


def pair(beats, seconds, dicrotic_ratio=0.3):
    model = morphology_segment(ppg_wave(beats, dicrotic_ratio, seconds, MODEL_HZ), MODEL_HZ)
    shape = morphology_segment(ppg_wave(beats, dicrotic_ratio, seconds, SHAPE_HZ), SHAPE_HZ)
    return detect_beats(model, shape), shape


def classify(beats, seconds, spans=()):
    detected, shape = pair(beats, seconds)
    return classify_beats(detected, shape, list(spans))


def nearest(classified, peak_s):
    return min(classified, key=lambda beat: abs(beat.peak_s - peak_s))


def with_gap(index, gap_s, seconds):
    beats, peak_s, k = [], 1.0, 0
    while peak_s < seconds - 1:
        beats.append((peak_s, 1.0))
        peak_s += gap_s if k == index else RR_S
        k += 1
    return beats


def test_a_regular_rhythm_is_all_normal_with_no_long_pause():
    classified = classify(regular_beats(1, 29, 72), 30)
    assert {beat.beat_class for beat in classified} == {"normal"}
    assert not any(beat.long_pause for beat in classified)


def test_upslope_floor_is_15_percent_of_the_median():
    detected, shape = pair(regular_beats(1, 29, 72), 30)
    median = sorted(beat.max_upslope for beat in detected)[len(detected) // 2]
    edited = list(detected)
    edited[10] = dataclasses.replace(detected[10], max_upslope=0.14 * median)
    edited[20] = dataclasses.replace(detected[20], max_upslope=0.15 * median)
    classified = classify_beats(edited, shape, [])
    assert classified[10].beat_class == "not-a-beat"
    assert classified[20].beat_class != "not-a-beat"


@pytest.mark.parametrize(
    "reason", ["motion", "pressure", "coverage", "coldHands", "quality", "clipping", "exposure"]
)
def test_a_beat_inside_any_rejected_span_is_an_artifact(reason):
    beats = regular_beats(1, 29, 72)
    target = beats[15][0]
    classified = classify(beats, 30, [RejectedSpan(target - 0.05, target + 0.05, reason)])
    assert nearest(classified, target).beat_class == "artifact"
    assert nearest(classified, target + RR_S).beat_class == "normal"


def test_impossible_intervals_make_the_ending_beat_an_artifact():
    beats = with_gap(12, 2.6, 30)
    after = nearest(classify(beats, 30), beats[13][0])
    assert (after.beat_class, after.long_pause) == ("artifact", False)
    detected, shape = pair(regular_beats(1, 29, 72), 30)
    early = dataclasses.replace(detected[10], peak_s=detected[10].peak_s + 0.2)
    assert classify_beats([*detected[:11], early, *detected[11:]], shape, [])[11].beat_class == "artifact"


def test_af_like_intervals_are_never_artifacts():
    uniforms = park_miller_uniforms(400, seed=777)
    beats, peak_s, k = [], 1.0, 0
    while peak_s < 118:
        beats.append((peak_s, 1.0))
        peak_s += 0.4 + 0.8 * uniforms[k]
        k += 1
    classified = classify(beats, 120)
    assert len(classified) == len(beats)
    assert not {"artifact", "not-a-beat"} & {beat.beat_class for beat in classified}


def test_small_and_early_and_small_premature_beats_are_atypical_and_kept():
    small = with_premature_beats(RR_S, 30, [15], 0.4, 0.7)
    assert nearest(classify(small, 30), small[15][0]).beat_class == "atypical"
    early_small = with_premature_beats(RR_S, 30, [15], 0.6, 0.6)
    assert nearest(classify(early_small, 30), early_small[15][0]).beat_class == "atypical"


def test_an_early_beat_that_is_not_small_stays_normal():
    beats = [(peak_s, 1.3 if k == 15 else 1.0) for k, (peak_s, _) in enumerate(with_gap(14, 0.8 * RR_S, 30))]
    assert nearest(classify(beats, 30), beats[15][0]).beat_class == "normal"


def test_bigeminy_premature_beats_are_all_kept_as_atypical():
    beats = with_premature_beats(60 / 75, 30, [2 * k + 1 for k in range(16)], 0.5, 0.6)
    classified = classify(beats, 30)
    assert len(classified) == len(beats)
    for peak_s, amplitude in beats:
        if amplitude < 1:
            assert nearest(classified, peak_s).beat_class == "atypical"


def test_long_pause_is_flagged_unless_a_rejected_span_lies_inside_it():
    beats = with_gap(12, 1.7 * RR_S, 30)
    flagged = nearest(classify(beats, 30), beats[13][0])
    assert (flagged.beat_class, flagged.long_pause) == ("normal", True)
    middle = (beats[12][0] + beats[13][0]) / 2
    spanned = nearest(classify(beats, 30, [RejectedSpan(middle - 0.1, middle + 0.1, "motion")]), beats[13][0])
    assert spanned.long_pause is False
    assert not any(beat.long_pause for beat in classify(with_gap(12, 1.5 * RR_S, 30), 30))


# Red-team v2 (ADR 0025, decisions 10-14), mirrored from packages/core/test/redteam/dsp9-classes.test.ts.
FLAT = ResampledSegment(first_index=0, values=np.zeros(256 * 120))


def flat_beats(peaks_s, amplitudes=(), upslopes=()):
    return [
        DetectedBeat(
            peak_s=peak_s,
            onset_s=peak_s - 0.1,
            max_upslope=upslopes[i] if i < len(upslopes) else 1.0,
            amplitude=amplitudes[i] if i < len(amplitudes) else 1.0,
        )
        for i, peak_s in enumerate(peaks_s)
    ]


def rhythm(bpm, count, pattern):
    rr_s = 60 / bpm
    peaks, amplitudes, t_s = [], [], 2.0
    for k in range(count):
        peaks.append(t_s)
        amplitudes.append(pattern[k % len(pattern)][1])
        t_s += pattern[(k + 1) % len(pattern)][0] * rr_s
    return peaks, amplitudes


@pytest.mark.parametrize("bpm", [55, 75, 90, 120])
def test_bigeminy_sinus_beats_stay_normal_and_no_compensatory_interval_is_a_long_pause(bpm):
    peaks, amplitudes = rhythm(bpm, 40, [(1.4, 1.0), (0.6, 0.45)])
    classified = classify_beats(flat_beats(peaks, amplitudes), FLAT, [])
    interior = classified[6:-6]
    assert [beat.beat_class for beat in interior[::2]] == ["normal"] * len(interior[::2])
    assert [beat.beat_class for beat in classified[1::2]] == ["atypical"] * len(classified[1::2])
    assert not any(beat.long_pause for beat in interior)


def test_trigeminy_has_no_long_pause_even_at_the_segment_end():
    peaks, amplitudes = rhythm(75, 45, [(1.4, 1.0), (1.0, 1.0), (0.6, 0.5)])
    classified = classify_beats(flat_beats(peaks, amplitudes), FLAT, [])
    assert [beat.beat_class for beat in classified] == [
        "atypical" if k % 3 == 2 else "normal" for k in range(len(classified))
    ]
    assert not any(beat.long_pause for beat in classified)


@pytest.mark.parametrize("field", ["peak_s", "amplitude", "max_upslope"])
def test_a_non_finite_beat_field_is_refused(field):
    beats = flat_beats([2.0 + k for k in range(12)])
    beats[5] = dataclasses.replace(beats[5], **{field: math.nan})
    with pytest.raises(ValueError):
        classify_beats(beats, FLAT, [])


def test_the_upslope_floor_ignores_candidates_inside_rejected_spans():
    peaks = [2.0 + k for k in range(30)]
    beats = flat_beats(peaks, upslopes=[20.0] * 20 + [1.0] * 10)
    classified = classify_beats(beats, FLAT, [RejectedSpan(1.0, 21.5, "motion")])
    assert {beat.beat_class for beat in classified[20:]} == {"normal"}


def test_a_candidate_near_the_segment_end_never_ends_a_long_pause():
    segment = ResampledSegment(first_index=0, values=np.zeros(256 * 10))
    peaks = [2.0 + k for k in range(7)] + [9.8]
    classified = classify_beats(flat_beats(peaks), segment, [])
    assert not any(beat.long_pause for beat in classified)
    far = ResampledSegment(first_index=0, values=np.zeros(256 * 20))
    assert classify_beats(flat_beats(peaks), far, [])[-1].long_pause


def test_a_first_beat_whose_upstroke_began_before_the_segment_has_no_onset():
    detected, _ = pair(regular_beats(0.1, 9, 72), 10)
    assert detected[0].onset_s is None
    assert detected[0].max_upslope > 0
    assert all(beat.onset_s is not None for beat in detected[1:])


# Parity-balanced reference windows (ADR 0025, decision 16).
def test_a_12_s_bigeminy_segment_has_no_long_pause_anywhere_edges_included():
    rr_s = 60 / 75
    peaks, amplitudes, t_s = [], [], 0.5
    while t_s < 11.3:
        peaks += [t_s, t_s + 0.6 * rr_s]
        amplitudes += [1.0, 0.45]
        t_s += 2 * rr_s
    segment = ResampledSegment(first_index=0, values=np.zeros(256 * 12))
    classified = classify_beats(flat_beats(peaks, amplitudes), segment, [])
    assert not any(beat.long_pause for beat in classified)
    assert {beat.beat_class for beat in classified[::2]} == {"normal"}


def test_fewer_than_2_plus_2_balanced_references_apply_no_amplitude_or_long_pause_rule():
    segment = ResampledSegment(first_index=0, values=np.zeros(256 * 8))
    classified = classify_beats(flat_beats([1.0, 2.0, 3.0, 5.5], [1.0, 0.3, 1.0, 1.0]), segment, [])
    assert [(beat.beat_class, beat.long_pause) for beat in classified] == [("normal", False)] * 4
