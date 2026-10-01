import math

import numpy as np
import pytest
from scipy import signal

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import CausalFilter, butter_bandpass, butter_lowpass, filter_zero_phase

HR_ORDER = DSP_CONFIG["dsp6"]["hrOrder"]
MORPHOLOGY_ORDER = DSP_CONFIG["dsp6"]["morphologyOrder"]
HR_BAND = DSP_CONFIG["dsp6"]["hrBandHz"]
MORPHOLOGY_BAND = DSP_CONFIG["dsp6"]["morphologyBandHz"]
MODEL_RATE_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
SHAPE_RATE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]
DESIGNS = [
    (HR_ORDER, HR_BAND, MODEL_RATE_HZ),
    (MORPHOLOGY_ORDER, MORPHOLOGY_BAND, MODEL_RATE_HZ),
    (MORPHOLOGY_ORDER, MORPHOLOGY_BAND, SHAPE_RATE_HZ),
]


def gain_at(sos, frequency_hz, rate_hz):
    _, response = signal.sosfreqz(sos, worN=[frequency_hz], fs=rate_hz)
    return float(np.abs(response[0]))


@pytest.mark.parametrize(("order", "band", "rate_hz"), DESIGNS)
def test_band_pass_unit_centre_gain_and_minus_3_db_edges(order, band, rate_hz):
    sos = butter_bandpass(order, band[0], band[1], rate_hz)
    tan_product = math.tan(math.pi * band[0] / rate_hz) * math.tan(math.pi * band[1] / rate_hz)
    centre_hz = rate_hz / math.pi * math.atan(math.sqrt(tan_product))
    assert gain_at(sos, centre_hz, rate_hz) == pytest.approx(1, abs=1e-9)
    assert gain_at(sos, band[0], rate_hz) == pytest.approx(math.sqrt(0.5), abs=1e-9)
    assert gain_at(sos, band[1], rate_hz) == pytest.approx(math.sqrt(0.5), abs=1e-9)
    assert gain_at(sos, 0, rate_hz) < 1e-12


@pytest.mark.parametrize("rate_hz", [MODEL_RATE_HZ, SHAPE_RATE_HZ])
def test_dc_low_pass_unit_dc_gain_and_minus_3_db_cutoff(rate_hz):
    dsp3 = DSP_CONFIG["dsp3"]
    sos = butter_lowpass(dsp3["dcOrder"], dsp3["dcCutoffHz"], rate_hz)
    assert gain_at(sos, 0, rate_hz) == pytest.approx(1, abs=1e-12)
    assert gain_at(sos, dsp3["dcCutoffHz"], rate_hz) == pytest.approx(math.sqrt(0.5), abs=1e-9)


def test_every_configured_section_is_stable():
    dsp3 = DSP_CONFIG["dsp3"]
    designs = [butter_bandpass(order, band[0], band[1], rate_hz) for order, band, rate_hz in DESIGNS]
    designs += [
        butter_lowpass(dsp3["dcOrder"], dsp3["dcCutoffHz"], rate) for rate in (MODEL_RATE_HZ, SHAPE_RATE_HZ)
    ]
    # Both poles of 1 + a1·z⁻¹ + a2·z⁻² lie inside the unit circle iff |a2| < 1 and |a1| < 1 + a2.
    for section in np.vstack(designs):
        a1, a2 = section[4], section[5]
        assert abs(a2) < 1
        assert abs(a1) < 1 + a2


def test_rejects_odd_orders_and_edges_outside_nyquist():
    with pytest.raises(ValueError, match="even"):
        butter_bandpass(3, 0.6, 3.5, 64)
    with pytest.raises(ValueError, match="even"):
        butter_lowpass(1, 0.3, 64)
    with pytest.raises(ValueError, match="edge"):
        butter_bandpass(4, 0.6, 40, 64)


def test_zero_phase_passes_an_in_band_sine_with_gain_squared_and_no_shift():
    sos = butter_bandpass(HR_ORDER, HR_BAND[0], HR_BAND[1], MODEL_RATE_HZ)
    t_s = np.arange(60 * MODEL_RATE_HZ) / MODEL_RATE_HZ
    pulse = np.sin(2 * math.pi * 1.2 * t_s)
    middle = (t_s >= 20) & (t_s < 40)
    filtered = filter_zero_phase(sos, pulse)
    gain2 = gain_at(sos, 1.2, MODEL_RATE_HZ) ** 2
    assert np.max(np.abs(filtered[middle] - gain2 * pulse[middle])) < 1e-6
    # Compared with |H|·sine, so only the phase can make the difference.
    causal = CausalFilter(sos).filter(pulse)
    gain = gain_at(sos, 1.2, MODEL_RATE_HZ)
    assert np.max(np.abs(causal[middle] - gain * pulse[middle])) > 0.1


def test_zero_phase_needs_more_samples_than_padlen():
    sos = butter_bandpass(HR_ORDER, HR_BAND[0], HR_BAND[1], MODEL_RATE_HZ)
    with pytest.raises(ValueError):
        filter_zero_phase(sos, np.zeros(27))
    assert len(filter_zero_phase(sos, np.zeros(28))) == 28


def test_causal_filter_starts_in_steady_state_and_is_batch_invariant():
    lowpass = butter_lowpass(2, 0.3, 64)
    assert np.allclose(CausalFilter(lowpass).filter(np.full(64, 0.62)), 0.62, rtol=0, atol=1e-12)
    empty_first = CausalFilter(lowpass)
    assert len(empty_first.filter(np.array([]))) == 0
    assert np.allclose(empty_first.filter(np.full(2, 0.62)), 0.62, rtol=0, atol=1e-12)
    samples = np.sin(np.arange(640) / 7) + 0.5
    whole = CausalFilter(lowpass).filter(samples)
    batched = CausalFilter(lowpass)
    pieces = np.concatenate([batched.filter(samples[start : start + 6]) for start in range(0, 640, 6)])
    assert np.array_equal(pieces, whole)
