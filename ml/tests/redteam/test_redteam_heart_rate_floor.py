import pytest

from lumen_dsp.metrics import MeasuredBeat, heart_rate

# Red team (§16) for PR #171 at 1363bd9 (ADR 0080): heart_rate needs the accepted intervals to sum to
# dsp11.minCleanS (15 s). The same beats and values as the last describe block of
# packages/core/test/redteam/reading-outcome-steps.test.ts, so both sides are held to one answer at the
# float boundary. Peaks are first + step × k, and the intervals are summed in index order on both sides.


def _beats(
    first_s: float, step_s: float, intervals: int, artifacts: tuple[int, ...] = ()
) -> list[MeasuredBeat]:
    return [
        MeasuredBeat(
            peak_s=first_s + step_s * k,
            beat_class="artifact" if k in artifacts else "normal",
            long_pause=False,
            amplitude=0.004,
            intensity=-0.62,
            dc=-0.62,
        )
        for k in range(intervals + 1)
    ]


@pytest.mark.parametrize(
    ("segments", "expected"),
    [
        pytest.param([_beats(0, 0.75, 20)], 80, id="20 x 0.75 s from 0 s sums to exactly 15"),
        pytest.param([_beats(1.4, 0.75, 20)], None, id="20 x 0.75 s from 1.4 s sums to 14.999999999999998"),
        pytest.param([_beats(1.1, 0.75, 20)], 80, id="20 x 0.75 s from 1.1 s sums to 15.000000000000002"),
        pytest.param([_beats(1, 14.999999 / 20, 20)], None, id="20 x (14.999999 / 20) s"),
        pytest.param([_beats(1, 15.000001 / 20, 20)], 79.99999466666705, id="20 x (15.000001 / 20) s"),
        pytest.param([_beats(0, 0.75, 10), _beats(20, 0.75, 10)], 80, id="two segments of 10 x 0.75 s"),
        pytest.param([_beats(0, 0.75, 22, (10,))], 80, id="22 x 0.75 s, beat 10 an artifact: 15 s left"),
        pytest.param([_beats(0, 0.75, 20, (10,))], None, id="20 x 0.75 s, beat 10 an artifact: 13.5 s left"),
    ],
)
def test_heart_rate_floor_matches_typescript_at_the_float_boundary(segments, expected):
    assert heart_rate(segments, 30) == expected
