import json

import numpy as np
import pytest
import vitaldb

from datasets.splits import ExternalDataError
from datasets.vitaldb_cases import HoldoutAccessError
from lumen_dsp.config import DSP_CONFIG
from train import vitaldb_pleth
from train.vitaldb_pleth import (
    MISSING_CODE,
    PLETH_RATE_HZ,
    SEGMENT_S,
    PlethRecord,
    extract_case,
    read_pleth,
    morphology_band,
    select_segments,
    window_reject_reason,
)

GAIN = 0.3949828125
OFFSET = -198.2504
WINDOW = SEGMENT_S * PLETH_RATE_HZ


def pulse_codes(seconds: float, levels: float = 120.0, bpm: float = 72.0) -> np.ndarray:
    t_s = np.arange(round(seconds * PLETH_RATE_HZ)) / PLETH_RATE_HZ
    phase = 2 * np.pi * bpm / 60 * t_s
    # A fundamental plus a second harmonic gives the systolic peak and dicrotic shoulder of a pulse.
    shape = np.sin(phase) + 0.4 * np.sin(2 * phase - 0.8)
    # Breathing modulates real beats by ~10%, so only a few beats reach the window's top code; identical
    # beats would all share one top code and look clipped.
    breathing = 1 + 0.1 * np.sin(2 * np.pi * 0.23 * t_s)
    return np.round(500 + levels / 2.8 * shape * breathing).astype(np.int16)


def write_vital(path, codes: np.ndarray | None, extra_track: bool = True) -> None:
    vital = vitaldb.VitalFile()
    if codes is not None:
        # vitaldb writes a float track with gain 1 and offset 0, so its values are the codes.
        values = codes.astype(np.float32)
        vital.add_track(
            vitaldb_pleth.PLETH_TRACK, [{"dt": vital.dtstart, "val": values}], srate=PLETH_RATE_HZ
        )
    if extra_track:
        vital.add_track("Solar8000/HR", [{"dt": vital.dtstart + 1, "val": 70.0}])
    vital.to_vital(str(path))


def test_clean_pulse_passes():
    assert window_reject_reason(pulse_codes(SEGMENT_S)) is None


def test_dropouts_longer_than_the_resampling_gap_are_rejected():
    codes = pulse_codes(SEGMENT_S)
    gap = round(0.3 * PLETH_RATE_HZ)
    codes[1000 : 1000 + gap] = MISSING_CODE
    assert window_reject_reason(codes) == "dropouts"


def test_many_short_dropouts_are_rejected():
    codes = pulse_codes(SEGMENT_S)
    # 2% of samples missing, each gap only 10 ms, so the fraction rule is what rejects it.
    codes[::50] = MISSING_CODE
    assert window_reject_reason(codes) == "dropouts"


def test_a_few_short_dropouts_are_allowed():
    codes = pulse_codes(SEGMENT_S)
    codes[5000:5020] = MISSING_CODE
    assert window_reject_reason(codes) is None


def test_flat_line_is_rejected():
    codes = pulse_codes(SEGMENT_S)
    codes[20000:21000] = codes[20000]
    assert window_reject_reason(codes) == "flat"


def test_clipped_peaks_are_rejected():
    codes = pulse_codes(SEGMENT_S)
    top = np.percentile(codes, 90)
    assert window_reject_reason(np.minimum(codes, top).astype(np.int16)) == "clipped"


def test_tiny_pulse_is_rejected():
    assert window_reject_reason(pulse_codes(SEGMENT_S, levels=5)) == "low-amplitude"


def test_amplitude_jump_is_rejected():
    codes = pulse_codes(SEGMENT_S).astype(float)
    half = len(codes) // 2
    codes[half:] = 500 + (codes[half:] - 500) * 3
    assert window_reject_reason(np.round(codes).astype(np.int16)) == "unstable-amplitude"


def test_noise_without_a_pulse_is_rejected():
    rng = np.random.default_rng(1)
    noise = np.round(500 + 40 * rng.standard_normal(WINDOW)).astype(np.int16)
    assert window_reject_reason(noise) == "aperiodic"


def test_morphology_band_at_256_hz_is_band_limited():
    seconds = SEGMENT_S
    t_s = np.arange(seconds * PLETH_RATE_HZ) / PLETH_RATE_HZ
    pulse = np.sin(2 * np.pi * 1.2 * t_s)
    drift = 5 * np.sin(2 * np.pi * 0.05 * t_s)
    hum = np.sin(2 * np.pi * 20 * t_s)
    codes = np.round(500 + 60 * (pulse + drift + hum)).astype(np.int16)
    rate = DSP_CONFIG["dsp2"]["shapeRateHz"]
    band = morphology_band(codes, GAIN, OFFSET, rate)
    assert band.first_index == 0
    assert len(band.values) == seconds * rate
    spectrum = np.abs(np.fft.rfft(band.values[rate * 10 : -rate * 10]))
    freqs = np.fft.rfftfreq(len(band.values) - rate * 20, 1 / rate)

    def power_near(hz: float) -> float:
        return spectrum[np.abs(freqs - hz) < 0.05].max()

    assert power_near(0.05) < 0.05 * power_near(1.2)
    assert power_near(20) < 0.05 * power_near(1.2)


def test_morphology_band_skips_missing_samples():
    codes = pulse_codes(SEGMENT_S)
    codes[3000:3040] = MISSING_CODE
    band = morphology_band(codes, GAIN, OFFSET, DSP_CONFIG["dsp2"]["shapeRateHz"])
    assert np.all(np.isfinite(band.values))
    assert len(band.values) == SEGMENT_S * DSP_CONFIG["dsp2"]["shapeRateHz"]


def test_select_segments_takes_the_earliest_stable_windows():
    record = np.concatenate(
        [
            np.full(WINDOW, 500, dtype=np.int16),
            pulse_codes(SEGMENT_S * 3),
            np.full(WINDOW // 2, MISSING_CODE, dtype=np.int16),
        ]
    )
    starts, rejections = select_segments(record, limit=2)
    assert starts == [WINDOW, 2 * WINDOW]
    assert rejections == {"flat": 1}


def test_select_segments_reports_every_rejection_when_nothing_passes():
    record = np.full(WINDOW * 2 + 10, 500, dtype=np.int16)
    starts, rejections = select_segments(record, limit=4)
    assert starts == [] and rejections == {"flat": 2}


def test_read_pleth_returns_integer_codes(tmp_path):
    codes = pulse_codes(30)
    write_vital(tmp_path / "0001.vital", codes)
    record = read_pleth(tmp_path / "0001.vital")
    np.testing.assert_array_equal(record.codes[: len(codes)], codes)
    assert record.codes.dtype == np.int16


def test_read_pleth_without_the_track_is_none(tmp_path):
    write_vital(tmp_path / "0002.vital", None)
    assert read_pleth(tmp_path / "0002.vital") is None


def test_read_pleth_refuses_anything_but_a_local_file(tmp_path):
    # ADR 0015: the vitaldb package fetches case numbers and URLs from vitaldb.net; Lumen never does.
    with pytest.raises(ValueError):
        read_pleth("https://api.vitaldb.net/0001.vital")
    with pytest.raises(FileNotFoundError):
        read_pleth(tmp_path / "missing.vital")


def test_read_pleth_refuses_external_files(data_dir):
    external = data_dir / "external" / "vitaldb-holdout"
    external.mkdir(parents=True)
    write_vital(external / "0004.vital", pulse_codes(10))
    with pytest.raises(ExternalDataError):
        read_pleth(external / "0004.vital")


def test_pleth_record_round_trips_missing_samples():
    values = np.array([np.nan, OFFSET, OFFSET + 3 * GAIN], dtype=np.float32)
    record = PlethRecord.from_values(values, GAIN, OFFSET)
    np.testing.assert_array_equal(record.codes, [MISSING_CODE, MISSING_CODE, 3])


def test_extract_case_caches_segments_and_resumes(tmp_path, monkeypatch):
    vital = tmp_path / "0007.vital"
    write_vital(vital, pulse_codes(SEGMENT_S * 2 + 5))
    out_dir = tmp_path / "derived"
    status = extract_case(7, 70, vital, out_dir)
    assert status["pleth"] is True and status["segments"] == 2 and status["dropped"] is None
    cached = np.load(out_dir / "segments" / "0007.npz")
    assert cached["codes"].shape == (2, WINDOW)
    np.testing.assert_array_equal(cached["start_s"], [0.0, SEGMENT_S])
    assert json.loads((out_dir / "status" / "0007.json").read_text(encoding="utf-8")) == status

    def fail_read(path):
        raise AssertionError(f"{path} was read again")

    monkeypatch.setattr(vitaldb_pleth, "read_pleth", fail_read)
    assert extract_case(7, 70, vital, out_dir) == status


def test_extract_case_redoes_a_case_cached_with_other_settings(tmp_path, monkeypatch):
    vital = tmp_path / "0007.vital"
    write_vital(vital, pulse_codes(SEGMENT_S * 2 + 5))
    out_dir = tmp_path / "derived"
    extract_case(7, 70, vital, out_dir)
    monkeypatch.setattr(vitaldb_pleth, "SEGMENTS_PER_CASE", 1)
    assert extract_case(7, 70, vital, out_dir)["segments"] == 1


def test_extract_case_records_why_a_case_is_dropped(tmp_path):
    write_vital(tmp_path / "0008.vital", None)
    status = extract_case(8, 80, tmp_path / "0008.vital", tmp_path / "derived")
    assert status["pleth"] is False and status["dropped"] == "no-pleth"
    assert not (tmp_path / "derived" / "segments" / "0008.npz").exists()

    write_vital(tmp_path / "0009.vital", np.full(WINDOW + 5, 500, dtype=np.int16))
    status = extract_case(9, 90, tmp_path / "0009.vital", tmp_path / "derived")
    assert status["pleth"] is True and status["dropped"] == "no-stable-segment"
    assert status["rejections"] == {"flat": 1}


def test_dev_case_files_refuse_a_holdout_patient(tmp_path):
    split = {"holdout": [4], "dev": [1, 2]}
    cases = {101: 1, 102: 2, 103: 4}
    with pytest.raises(HoldoutAccessError):
        vitaldb_pleth.dev_case_files(cases, split, tmp_path)
    assert vitaldb_pleth.dev_case_files({101: 1}, split, tmp_path) == [(101, 1, tmp_path / "0101.vital")]


def test_load_segments_gives_both_dsp2_bands(tmp_path):
    vital = tmp_path / "0007.vital"
    write_vital(vital, pulse_codes(SEGMENT_S + 5))
    extract_case(7, 70, vital, tmp_path)
    segments = vitaldb_pleth.load_segments(7, tmp_path)
    assert len(segments) == 1 and segments[0].start_s == 0.0
    assert len(segments[0].model.values) == SEGMENT_S * DSP_CONFIG["dsp2"]["modelRateHz"]
    assert len(segments[0].shape.values) == SEGMENT_S * DSP_CONFIG["dsp2"]["shapeRateHz"]
