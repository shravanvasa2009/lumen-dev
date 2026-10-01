import torch
from torch import nn

from nets.blocks import conv_block

# §11.2: a 4 s finger window of the red and green channels resampled to 64 Hz.
CHANNELS = 2
WINDOW = 256


class SqiNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            *conv_block(CHANNELS, 16, 7),
            nn.MaxPool1d(2),
            *conv_block(16, 32, 5),
            nn.MaxPool1d(2),
            *conv_block(32, 32, 5),
        )
        self.head = nn.Linear(32, 1)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        pooled = self.features(window).mean(dim=2)
        return torch.sigmoid(self.head(pooled))
