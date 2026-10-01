import torch
from torch import nn

# §11.2: a 4 s finger window of the red and green channels resampled to 64 Hz.
CHANNELS = 2
WINDOW = 256


def _conv_block(in_channels: int, out_channels: int, kernel: int) -> list[nn.Module]:
    # "same" padding keeps the window length, so pooling halves it exactly (256 → 128 → 64).
    return [
        nn.Conv1d(in_channels, out_channels, kernel, padding=kernel // 2),
        nn.BatchNorm1d(out_channels),
        nn.ReLU(),
    ]


class SqiNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            *_conv_block(CHANNELS, 16, 7),
            nn.MaxPool1d(2),
            *_conv_block(16, 32, 5),
            nn.MaxPool1d(2),
            *_conv_block(32, 32, 5),
        )
        self.head = nn.Linear(32, 1)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        pooled = self.features(window).mean(dim=2)
        return torch.sigmoid(self.head(pooled))
