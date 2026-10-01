import torch
from torch import nn

from nets.blocks import Standardize

INTERVALS = 64
FEATURES = 8
LABELS = ("sinus", "af", "other")

# Stands in for masked intervals while sorting, so they land after every real interval (seconds or ms).
_SORT_SENTINEL = 1e9
# Guards the division when a caller sends zero-length intervals; real intervals are ≥ 0.2 s.
_MIN_MEDIAN = 1e-6


def _masked_median(intervals: torch.Tensor, valid: torch.Tensor) -> torch.Tensor:
    ordered, _ = torch.sort(torch.where(valid, intervals, torch.full_like(intervals, _SORT_SENTINEL)), dim=1)
    count = valid.sum(dim=1, keepdim=True)
    # Mean of the two middle values; with no valid interval both indices clamp to 0 and the result is
    # discarded, because every position is masked.
    lower = ordered.gather(1, ((count - 1) // 2).clamp(min=0))
    upper = ordered.gather(1, (count // 2).clamp(max=INTERVALS - 1))
    return ((lower + upper) / 2).clamp(min=_MIN_MEDIAN)


class RhythmNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.interval_branch = nn.Sequential(
            nn.Conv1d(2, 32, 5, padding=2),
            nn.ReLU(),
            nn.Conv1d(32, 32, 5, padding=2),
            nn.ReLU(),
        )
        self.standardize = Standardize(FEATURES)
        self.feature_branch = nn.Sequential(nn.Linear(FEATURES, 16), nn.ReLU())
        self.head = nn.Linear(48, len(LABELS))
        # Set by temperature scaling on development-validation (§11.3); 1.0 means uncalibrated.
        self.register_buffer("temperature", torch.ones(()))

    def forward(self, intervals: torch.Tensor, mask: torch.Tensor, features: torch.Tensor) -> torch.Tensor:
        valid = mask > 0.5
        # The model divides by the median itself, so the app sends raw intervals in any time unit.
        # torch.where (not multiplication) keeps NaN or inf in masked slots from leaking into the output.
        normalized = torch.where(
            valid, intervals / _masked_median(intervals, valid), torch.zeros_like(intervals)
        )
        weight = valid.to(intervals.dtype)
        hidden = self.interval_branch(torch.stack((normalized, weight), dim=1))
        # Pool only over real intervals; an all-masked window pools to zeros instead of dividing by zero.
        pooled = (hidden * weight.unsqueeze(1)).sum(dim=2) / weight.sum(dim=1, keepdim=True).clamp(min=1.0)
        joined = torch.cat((pooled, self.feature_branch(self.standardize(features))), dim=1)
        return torch.softmax(self.head(joined) / self.temperature, dim=1)
