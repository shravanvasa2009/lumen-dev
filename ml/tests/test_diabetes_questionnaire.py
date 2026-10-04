import numpy as np
import pandas as pd

from eval import diabetes_questionnaire
from eval.diabetes_questionnaire import partial_points, stacked


def clinical(**columns):
    base = {"age": ["45"], "sex": ["F"], "bmi": [22.0], "preop_htn": [0]}
    return pd.DataFrame({**base, **columns})


def test_partial_points_score_age_sex_bmi_and_blood_pressure_only():
    # 45 → 1, male → 1, BMI 31 → 2, hypertension → 1; family history and activity are not in VitalDB.
    frame = clinical(age=["45"], sex=["M"], bmi=[31.0], preop_htn=[1])
    assert partial_points(frame).tolist() == [5.0]


def test_vitaldb_text_ages_and_missing_values():
    frame = pd.DataFrame(
        {
            "age": [">89", "18", None, "50"],
            "sex": ["F", "F", "F", "F"],
            "bmi": [22.0, 22.0, 22.0, np.nan],
            "preop_htn": [0, 0, 0, 0],
        }
    )
    # ">89" reads as 89 (3 points); under 20 has no validated score; missing age or BMI gives no score.
    points = partial_points(frame).tolist()
    assert points[0] == 3.0 and all(np.isnan(value) for value in points[1:])


def test_stacking_never_scores_a_subject_with_a_model_fitted_on_it(monkeypatch):
    fitted_rows: list[set[float]] = []

    class SpyLogistic(diabetes_questionnaire.LogisticRegression):
        def fit(self, features, labels):
            fitted_rows.append(set(features[:, 1].tolist()))
            return super().fit(features, labels)

        def predict_proba(self, features):
            assert not set(features[:, 1].tolist()) & fitted_rows[-1]
            return super().predict_proba(features)

    monkeypatch.setattr(diabetes_questionnaire, "LogisticRegression", SpyLogistic)
    rng = np.random.default_rng(0)
    labels = np.repeat([0, 1], 50)
    # Unique pulse values identify each subject's row in the fit and predict calls.
    scores = stacked(labels + rng.normal(0, 0.1, 100), rng.permutation(100) / 100.0, labels, seed=1)
    assert scores.shape == (100,) and len(fitted_rows) == diabetes_questionnaire.FOLDS
