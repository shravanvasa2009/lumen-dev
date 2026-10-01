import math

import numpy as np

from lumen_dsp.signals import dc_level, finger_signals
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
