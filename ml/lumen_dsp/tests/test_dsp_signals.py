import math

import numpy as np

import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.signals import dc_level, finger_signals, sqi_model_input, z_score_window
from lumen_dsp.tests.synthetic import capture_at
from lumen_dsp.timebase import build_timebase


def test_inverted_red_is_primary_and_inverted_green_is_secondary():
    red = [0.6, 0.65, 0.7]
    green = [0.12, 0.1, 0.08]

    def channels(t_s):
        frame = round(t_s * 30)
        return red[frame], green[frame], 0.05

    primary, secondary = finger_signals(build_timebase(*capture_at([0, 1 / 30, 2 / 30], channels)))
    assert primary.tolist() == [-0.6, -0.65, -0.7]
    assert secondary.tolist() == [-0.12, -0.1, -0.08]


def test_dc_level_keeps_baseline_and_drift_and_removes_the_pulse():
    # Same bound as the TypeScript test: pulse residue ≈ 2.3e-5, drift loss ≈ 7.7e-6.
    rate_hz = 64
    t_s = np.arange(60 * rate_hz) / rate_hz
    baseline = 0.6 + 0.01 * np.sin(2 * math.pi * 0.05 * t_s)
    dc = dc_level(baseline + 0.006 * np.sin(2 * math.pi * 1.2 * t_s), rate_hz)
    middle = (t_s >= 10) & (t_s < 50)
    assert np.max(np.abs(dc[middle] - baseline[middle])) < 5e-5


def test_model_windows_are_4_s_or_256_samples_at_64_hz():
    assert DSP_CONFIG["dsp3"]["modelWindowS"] * DSP_CONFIG["dsp2"]["modelRateHz"] == 256


def test_z_score_uses_the_population_sd():
    sd = math.sqrt(1.25)
    assert z_score_window([1, 2, 3, 4]) == pytest.approx(
        [-1.5 / sd, -0.5 / sd, 0.5 / sd, 1.5 / sd], abs=1e-15
    )


def test_flat_window_has_no_z_score():
    assert z_score_window([-0.62] * 256) is None


def test_sqi_input_is_the_z_scored_primary_as_float32():
    # SQI-Net v1 takes −R only, [N, 1, 256] (ADR 0023).
    primary = -0.6 - 0.004 * np.sin(2 * math.pi * 1.2 * np.arange(256) / 64)
    model_input = sqi_model_input(primary)
    assert model_input.dtype == np.float32
    assert model_input.shape == (256,)
    assert np.array_equal(model_input, np.asarray(z_score_window(primary), dtype=np.float32))


def test_no_sqi_input_for_a_flat_window():
    assert sqi_model_input(np.full(256, -1.0)) is None


def test_sqi_input_needs_256_samples():
    pulse = np.sin(np.arange(255) / 9)
    with pytest.raises(ValueError):
        sqi_model_input(pulse)
