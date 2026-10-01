import numpy as np
import pytest
import torch

from export.specs import SPECS
from export.to_onnx import source_model
from nets.rhythm_net import RhythmNet
from nets.sqi_net import SqiNet


def _parameter_count(model: torch.nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())


def _rhythm_inputs(batch: int, valid: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    generator = torch.Generator().manual_seed(3)
    intervals = 0.4 + torch.rand(batch, 64, generator=generator)
    mask = (torch.arange(64) < valid).float().expand(batch, 64).clone()
    return intervals, mask, torch.randn(batch, 8, generator=generator)


@pytest.mark.parametrize("name", sorted(SPECS))
def test_output_shape_and_probability_range(name):
    spec = SPECS[name]
    model = source_model(spec, runs_dir=None, random_seed=1)
    inputs = [torch.randn(5, *shape[1:]) for shape in spec.inputs.values()]
    if name == "rhythm-net":
        inputs = list(_rhythm_inputs(5, valid=40))
    with torch.no_grad():
        probabilities = model(*inputs)
    (output_shape,) = spec.outputs.values()
    assert probabilities.shape == (5, *output_shape[1:])
    assert torch.all((probabilities >= 0) & (probabilities <= 1))


def test_sqi_parameter_count_matches_the_spec_architecture():
    # §11.2 with ADR 0023's single input channel: conv(1→16,k7)+BN, conv(16→32,k5)+BN,
    # conv(32→32,k5)+BN, linear(32→1).
    expected = (
        (1 * 16 * 7 + 16 + 2 * 16) + (16 * 32 * 5 + 32 + 2 * 32) + (32 * 32 * 5 + 32 + 2 * 32) + (32 + 1)
    )
    assert _parameter_count(SqiNet()) == expected == 8065


def test_rhythm_probabilities_sum_to_one():
    with torch.no_grad():
        probabilities = RhythmNet().eval()(*_rhythm_inputs(4, valid=64))
    assert torch.allclose(probabilities.sum(dim=1), torch.ones(4))


@pytest.mark.parametrize("valid", [0, 1, 2, 31, 63])
@pytest.mark.parametrize("filler", [0.0, 1e6, -5.0, float("nan"), float("inf")])
def test_masked_intervals_do_not_change_the_output(valid, filler):
    model = source_model(SPECS["rhythm-net"], runs_dir=None, random_seed=2)
    intervals, mask, features = _rhythm_inputs(3, valid)
    altered = intervals.clone()
    altered[mask == 0] = filler
    with torch.no_grad():
        assert torch.equal(model(intervals, mask, features), model(altered, mask, features))


def test_scattered_mask_also_ignores_masked_values():
    model = source_model(SPECS["rhythm-net"], runs_dir=None, random_seed=2)
    intervals, _, features = _rhythm_inputs(2, valid=64)
    mask = (torch.arange(64) % 3 != 0).float().expand(2, 64).clone()
    altered = torch.where(mask > 0, intervals, torch.full_like(intervals, 9.0))
    with torch.no_grad():
        assert torch.equal(model(intervals, mask, features), model(altered, mask, features))


def test_rhythm_output_does_not_depend_on_the_interval_unit():
    # The model divides by the median, so seconds and milliseconds give the same answer.
    model = source_model(SPECS["rhythm-net"], runs_dir=None, random_seed=2)
    intervals, mask, features = _rhythm_inputs(3, valid=50)
    with torch.no_grad():
        assert torch.allclose(
            model(intervals, mask, features), model(intervals * 1000, mask, features), atol=1e-6
        )


def test_all_masked_window_gives_finite_probabilities():
    model = source_model(SPECS["rhythm-net"], runs_dir=None, random_seed=2)
    intervals, mask, features = _rhythm_inputs(2, valid=0)
    with torch.no_grad():
        assert torch.isfinite(model(intervals, mask, features)).all()


def test_temperature_is_a_saved_buffer_that_softens_probabilities():
    model = RhythmNet().eval()
    assert "temperature" in model.state_dict()
    inputs = _rhythm_inputs(1, valid=64)
    with torch.no_grad():
        sharp = model(*inputs)
        model.temperature.fill_(100.0)
        soft = model(*inputs)
    assert np.isclose(float(soft.max()), 1 / 3, atol=1e-2)
    assert float(soft.max()) < float(sharp.max())
