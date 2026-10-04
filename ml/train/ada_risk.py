from typing import NamedTuple

# ADR 0087: the diabetes risk questionnaire, scored with the ORIGINAL validated points of Bang et al. 2009
# (Ann Intern Med 151:775-783, Table 2; https://pmc.ncbi.nlm.nih.gov/articles/PMC3633111/). The CDC printable
# form adds a gestational-diabetes item and scores inactivity +1 instead of activity −1; neither change was
# validated, so the app may ask it but the score uses these points. Validated on US adults aged 20 or
# older without known diabetes.
MIN_AGE_YEARS = 20
AGE_POINTS = ((60, 3), (50, 2), (40, 1))
BMI_POINTS = ((40.0, 3), (30.0, 2), (25.0, 1))
FLAG_AT = 5


class AdaRisk(NamedTuple):
    points: int
    flagged: bool  # points ≥ 5: the cut-off Bang 2009 validated for undiagnosed diabetes


def _points(value: float, table: tuple[tuple[float, int], ...]) -> int:
    return next((points for threshold, points in table if value >= threshold), 0)


def ada_risk(
    age_years: int,
    male: bool,
    family_history: bool,
    hypertension: bool,
    physically_active: bool,
    bmi: float,
) -> AdaRisk | None:
    # Answers may arrive untyped (storage, a spreadsheet): refuse them, as the TS twin does, rather than let
    # int() score male=2 as two points or a bool pass as an age. None under 20: never validated there.
    for name, value in (("age_years", age_years), ("bmi", bmi)):
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise TypeError(f"{name} must be a number, got {value!r}")
    for name, value in (
        ("male", male),
        ("family_history", family_history),
        ("hypertension", hypertension),
        ("physically_active", physically_active),
    ):
        if not isinstance(value, bool):
            raise TypeError(f"{name} must be True or False, got {value!r}")
    # The chained comparisons are False for NaN, so NaN is refused too.
    if not 0 <= age_years <= 130:
        raise ValueError(f"age_years must be 0-130, got {age_years}")
    if not 10.0 <= bmi <= 100.0:
        raise ValueError(f"bmi must be 10-100 kg/m², got {bmi}")
    if age_years < MIN_AGE_YEARS:
        return None
    points = (
        _points(age_years, AGE_POINTS)
        + int(male)
        + int(family_history)
        + int(hypertension)
        - int(physically_active)
        + _points(bmi, BMI_POINTS)
    )
    return AdaRisk(points, points >= FLAG_AT)
