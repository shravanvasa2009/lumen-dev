import torch
from torch import nn

from nets.blocks import Standardize, conv_block

# §11.4: one ensemble-averaged beat at 256 Hz (DSP-14), 12 shape features, 4 HR/HRV summary values.
BEAT = 256
# The order lumen_dsp.shape_features returns them (ADR 0059; packages/core shapeFeatures). Times are
# fractions of the beat period; heights are above the beat's minimum, relative to the systolic peak; the
# x/a ratios are on the second derivative.
SHAPE_FEATURE_NAMES = (
    "riseTime",
    "width50",
    "width25",
    "notchTime",
    "notchHeight",
    "diastolicPeakHeight",
    "bOverA",
    "cOverA",
    "dOverA",
    "eOverA",
    "agingIndex",
    "areaRatio",
)
SHAPE_FEATURES = len(SHAPE_FEATURE_NAMES)
# The order lumen_dsp.metrics.hr_summary returns them, in bpm, ms, ms, and a fraction.
HR_SUMMARY_NAMES = ("hrBpm", "rmssdMs", "sdnnMs", "pnn50")
HR_SUMMARY = len(HR_SUMMARY_NAMES)


class DiabetesNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        # Kept small on purpose: public diabetes data has a few thousand subjects at most.
        self.beat_branch = nn.Sequential(
            *conv_block(1, 8, 7),
            nn.MaxPool1d(4),
            *conv_block(8, 16, 5),
            nn.MaxPool1d(4),
            *conv_block(16, 16, 5),
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
