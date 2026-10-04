import pytest

from train.ada_risk import FLAG_AT, AdaRisk, ada_risk


def score(**changes):
    answers = {
        "age_years": 35,
        "male": False,
        "family_history": False,
        "hypertension": False,
        "physically_active": False,
        "bmi": 22.0,
    }
    return ada_risk(**{**answers, **changes})


@pytest.mark.parametrize(
    ("age", "points"), [(20, 0), (39, 0), (40, 1), (49, 1), (50, 2), (59, 2), (60, 3), (90, 3)]
)
def test_age_points_follow_bang_2009(age, points):
    assert score(age_years=age).points == points


@pytest.mark.parametrize(
    ("bmi", "points"), [(24.99, 0), (25.0, 1), (29.99, 1), (30.0, 2), (39.99, 2), (40.0, 3)]
)
def test_bmi_points_follow_bang_2009(bmi, points):
    assert score(bmi=bmi).points == points


def test_each_yes_answer_adds_one_and_activity_takes_one_away():
    assert score(male=True).points == 1
    assert score(family_history=True).points == 1
    assert score(hypertension=True).points == 1
    assert score(physically_active=True).points == -1


def test_the_range_is_minus_one_to_nine():
    lowest = score(age_years=20, physically_active=True, bmi=18.0)
    highest = score(age_years=70, male=True, family_history=True, hypertension=True, bmi=45.0)
    assert (lowest.points, highest.points) == (-1, 9)


def test_flag_is_at_five_or_more():
    assert score(age_years=60, male=True).points == 4 and not score(age_years=60, male=True).flagged
    assert score(age_years=60, male=True, hypertension=True) == AdaRisk(FLAG_AT, True)


@pytest.mark.parametrize("age", [0, 13, 17, 19])
def test_under_20_has_no_score_because_it_was_never_validated(age):
    assert score(age_years=age) is None


@pytest.mark.parametrize(
    ("field", "value"), [("age_years", -1), ("age_years", 131), ("bmi", 9.9), ("bmi", 100.1)]
)
def test_impossible_answers_are_refused(field, value):
    with pytest.raises(ValueError):
        score(**{field: value})


@pytest.mark.parametrize("field", ["male", "family_history", "hypertension", "physically_active"])
@pytest.mark.parametrize("value", [0, 1, 2, "yes", None])
def test_yes_no_answers_must_be_booleans(field, value):
    # male=2 would otherwise score two points; 0/1 from storage must be converted on purpose, not silently.
    with pytest.raises(TypeError):
        score(**{field: value})


@pytest.mark.parametrize("field", ["age_years", "bmi"])
@pytest.mark.parametrize("value", ["45", None, True])
def test_age_and_bmi_must_be_numbers(field, value):
    with pytest.raises(TypeError):
        score(**{field: value})


@pytest.mark.parametrize("field", ["age_years", "bmi"])
def test_nan_age_or_bmi_is_refused(field):
    with pytest.raises(ValueError):
        score(**{field: float("nan")})
