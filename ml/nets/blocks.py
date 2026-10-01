import torch
from torch import nn


def conv_block(in_channels: int, out_channels: int, kernel: int) -> list[nn.Module]:
    # "same" padding keeps the length, so each MaxPool divides it exactly (for example 256 → 128 → 64).
    return [
        nn.Conv1d(in_channels, out_channels, kernel, padding=kernel // 2),
        nn.BatchNorm1d(out_channels),
        nn.ReLU(),
    ]


class Standardize(nn.Module):
    # Training fills mean and std from development-train subjects; keeping them as buffers folds the
    # scaling into the ONNX graph, so the app sends raw DSP features and cannot drift from training.
    def __init__(self, width: int) -> None:
        super().__init__()
        self.register_buffer("mean", torch.zeros(width))
        self.register_buffer("std", torch.ones(width))

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return (features - self.mean) / self.std
