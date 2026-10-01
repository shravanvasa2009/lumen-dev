import torch
from torch import nn


class Standardize(nn.Module):
    # Training fills mean and std from development-train subjects; keeping them as buffers folds the
    # scaling into the ONNX graph, so the app sends raw DSP features and cannot drift from training.
    def __init__(self, width: int) -> None:
        super().__init__()
        self.register_buffer("mean", torch.zeros(width))
        self.register_buffer("std", torch.ones(width))

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return (features - self.mean) / self.std
