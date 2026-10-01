import torch
from torch import nn

from nets.standardize import Standardize

# §11.4: one ensemble-averaged beat at 256 Hz (DSP-14), 12 shape features, 4 HR/HRV summary values.
BEAT = 256
SHAPE_FEATURES = 12
HR_SUMMARY = 4


def _conv_block(in_channels: int, out_channels: int, kernel: int) -> list[nn.Module]:
    return [
        nn.Conv1d(in_channels, out_channels, kernel, padding=kernel // 2),
        nn.BatchNorm1d(out_channels),
        nn.ReLU(),
    ]


class DiabetesNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        # Kept small on purpose: public diabetes data has a few thousand subjects at most.
        self.beat_branch = nn.Sequential(
            *_conv_block(1, 8, 7),
            nn.MaxPool1d(4),
            *_conv_block(8, 16, 5),
            nn.MaxPool1d(4),
            *_conv_block(16, 16, 5),
        )
        self.standardize = Standardize(SHAPE_FEATURES + HR_SUMMARY)
        self.head = nn.Sequential(
            nn.Linear(16 + SHAPE_FEATURES + HR_SUMMARY, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
        )

    def forward(
        self, beat: torch.Tensor, shape_features: torch.Tensor, hr_summary: torch.Tensor
    ) -> torch.Tensor:
        pooled = self.beat_branch(beat).mean(dim=2)
        tabular = self.standardize(torch.cat((shape_features, hr_summary), dim=1))
        return torch.sigmoid(self.head(torch.cat((pooled, tabular), dim=1)))
