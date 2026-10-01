import sys
from types import SimpleNamespace

import numpy as np
import pytest

from eval.external_mimic import (
    ChannelError,
    DspNotMergedError,
    beat_modules,
    load_recording,
    pick_channel,
    reading_windows,
    record_paths,
    reference_rows,
    rhythm_inputs,
    sqi_windows,
)
from tests.external_fixtures import LAG_S, write_mimic


def beat(peak_s, beat_class="normal"):
    return SimpleNamespace(peak_s=peak_s, beat_class=beat_class)


def test_missing_dsp7_mirror_is_a_clear_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "lumen_dsp.beats", None)
    with pytest.raises(DspNotMergedError, match="Track C"):
        beat_modules()


def test_channels_follow_the_fixed_preference():
    assert pick_channel(["V", "II", "ECG", "PLETH"], ("II", "ECG", "EKG")) == 1
    assert pick_channel(["ecg ", "pleth"], ("II", "ECG", "EKG")) == 0
    with pytest.raises(ChannelError):
        pick_channel(["ABP", "RESP"], ("PLETH", "PPG"))


def test_rhythm_inputs_mirror_the_app():
    # Segment 1: normal, not-a-beat (dropped), artifact, normal. Segment 2: atypical, normal.
    segments = [
        [beat(1.0), beat(1.4, "not-a-beat"), beat(1.8, "artifact"), beat(2.6)],
        [beat(10.0, "atypical"), beat(10.9)],
    ]
    intervals, spans, atypical, peaks = rhythm_inputs(segments)
    assert intervals == pytest.approx([0.8, 0.8, 7.4, 0.9])
    # Both intervals touching the artifact, and the one crossing the segment gap, span an artifact.
    assert spans == [True, True, True, False]
    assert atypical == [False, False, False, True, False]
    assert peaks == [1.0, 1.8, 2.6, 10.0, 10.9]


def test_readings_are_90_second_blocks_by_end_beat():
    peaks = np.arange(0.5, 200, 0.8)
    intervals = list(np.diff(peaks))
    windows = reading_windows(intervals, [False] * len(intervals), [False] * len(peaks), list(peaks))
    ends_per_block = np.bincount(np.floor(peaks[1:] / 90).astype(int))
    # The last block (180-200 s) has fewer than 32 intervals, so it yields no window; no window straddles
    # two blocks, so each block gives exactly the DSP-15 count for its own intervals.
    assert ends_per_block[2] < 32
    for block in (0, 1):
        expected = (ends_per_block[block] - 32) // 16 + 1
        assert sum(1 for index, _window in windows if index == block) == expected
    assert {index for index, _window in windows} == {0, 1}


def test_sqi_windows_are_4_s_every_1_s_and_flat_windows_are_none():
    t_s = np.arange(0, 10, 1 / 125)
    values = np.sin(2 * np.pi * 1.2 * t_s)
    values[t_s >= 5.5] = 1.0
    windows = sqi_windows(t_s, values)
    starts = [start for start, _input in windows]
    assert starts[:3] == pytest.approx([0.0, 1.0, 2.0])
    assert all(model_input is None or model_input.shape == (256,) for _start, model_input in windows)
    assert windows[0][1] is not None
    assert windows[-1][1] is None


def test_reference_rows_use_one_lag_per_subject():
    r_peaks = np.arange(0.5, 60, 0.8)
    clean, hr, lag = reference_rows([0.0, 10.0, 20.0], r_peaks, r_peaks + LAG_S)
    assert lag == pytest.approx(LAG_S)
    assert clean.tolist() == [True, True, True]
    assert hr == pytest.approx([75.0, 75.0, 75.0])


def test_missed_ppg_beats_make_a_window_not_reference_clean():
    r_peaks = np.arange(0.5, 60, 0.8)
    ppg = r_peaks + LAG_S
    ppg = ppg[(ppg < 20) | (ppg > 22)]
    clean, _hr, _lag = reference_rows([0.0, 19.0], r_peaks, ppg)
    assert clean.tolist() == [True, False]


def test_no_lag_means_no_reference_clean_window():
    r_peaks = np.arange(0.5, 60, 0.8)
    clean, _hr, lag = reference_rows([0.0], r_peaks, np.array([]))
    assert lag is None
    assert clean.tolist() == [False]


def test_records_are_labeled_by_archive(tmp_path):
    write_mimic(tmp_path, af_subjects=1, non_af_subjects=2)
    found = record_paths(tmp_path)
    assert [is_af for _path, is_af in found] == [True, False, False]
    recording = load_recording(*found[0])
    assert recording.subject == "af:mimic_perform_af_001_data"
    assert recording.fs == 125.0
    # PLETH is the second signal in the fixture, II the first.
    assert np.corrcoef(recording.ppg[:500], recording.ecg[:500])[0, 1] < 0.9
