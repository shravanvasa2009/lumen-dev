import json

import numpy as np
import pandas as pd
import pytest

from eval import nhanes_test
from export import nhanes_parity
from train import nhanes_questionnaire as nq


def raw_participant(**changes) -> dict:
    row = {
        "SEQN": 1.0,
        "RIDSTATR": 2.0,
        "RIDAGEYR": 50.0,
        "RIDEXPRG": np.nan,
        "RIAGENDR": 2.0,
        "BMXWT": 81.0,
        "BMXHT": 180.0,
        "MCQ300C": 2.0,
        "BPQ020": 2.0,
        "PAQ650": 2.0,
        "PAQ665": 2.0,
        "RHQ162": np.nan,
        "DIQ010": 2.0,
        "LBXGH": 5.4,
        "LBXGLU": np.nan,
        "WTMEC2YR": 1000.0,
    }
    return {**row, **changes}


def answers(**changes) -> pd.DataFrame:
    return nq.answers_and_label(pd.DataFrame([raw_participant(**changes)]), "G")


def test_a_complete_adult_becomes_one_row_of_answers():
    row = answers().iloc[0]
    assert row.bmi == pytest.approx(25.0)
    assert (row.male, row.familyHistory, row.hypertension, row.physicallyActive) == (0, 0, 0, 0)
    assert row.diabetes == 0


@pytest.mark.parametrize(
    "changes",
    [{"DIQ010": 1.0}, {"LBXGH": 6.5}, {"LBXGLU": 126.0}],
)
def test_diabetes_is_a_diagnosis_or_a_lab_value_at_the_cut_off(changes):
    assert answers(**changes).iloc[0].diabetes == 1


def test_borderline_and_lab_values_below_the_cut_off_are_not_diabetes():
    assert answers(DIQ010=3.0, LBXGH=6.4, LBXGLU=125.0).iloc[0].diabetes == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"RIDAGEYR": 19.0},
        {"RIDSTATR": 1.0},
        {"RIDEXPRG": 1.0},
        {"BPQ020": 9.0},
        {"PAQ650": np.nan, "PAQ665": 9.0},
        {"BMXWT": np.nan},
        {"BMXWT": 30.0},
        {"DIQ010": 9.0, "LBXGH": np.nan},
    ],
)
def test_people_without_the_answers_or_a_label_are_left_out(changes):
    assert answers(**changes).empty


@pytest.mark.parametrize("code", [7.0, 9.0, np.nan])
def test_refusing_or_not_knowing_about_a_relative_counts_as_no(code):
    assert answers(MCQ300C=code).iloc[0].familyHistory == 0


def test_each_exclusion_is_counted_once_at_its_first_failing_step():
    raw = pd.DataFrame(
        [
            raw_participant(),
            raw_participant(SEQN=2.0, RIDAGEYR=15.0, BPQ020=9.0),
            raw_participant(SEQN=3.0, BPQ020=9.0),
        ]
    )
    counts = nq.exclusion_counts(raw)
    assert counts["participants"] == 3 and counts["included"] == 1
    assert counts["excludedAt"]["age20OrOlder"] == 1 and counts["excludedAt"]["bloodPressureAnswered"] == 1
    assert sum(counts["excludedAt"].values()) == 2


def test_either_recreational_activity_counts_as_active():
    assert answers(PAQ650=np.nan, PAQ665=1.0).iloc[0].physicallyActive == 1


def test_gestational_diabetes_counts_only_for_women():
    assert answers(RHQ162=1.0).iloc[0].gestationalDiabetes == 1
    assert answers(RIAGENDR=1.0, RHQ162=1.0).iloc[0].gestationalDiabetes == 0


def cohort(size: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    frame = pd.DataFrame(
        {
            "cycle": rng.choice(list(nq.TRAIN_CYCLES), size),
            "ageYears": rng.uniform(20, 85, size),
            "male": rng.integers(0, 2, size).astype(float),
            "bmi": rng.uniform(18, 45, size),
            "familyHistory": rng.integers(0, 2, size).astype(float),
            "hypertension": rng.integers(0, 2, size).astype(float),
            "physicallyActive": rng.integers(0, 2, size).astype(float),
            "gestationalDiabetes": np.zeros(size),
            "diagnosed": np.zeros(size, dtype=int),
            "examWeight": np.ones(size),
        }
    )
    risk = (
        0.05 * (frame.ageYears - 50) + 0.1 * (frame.bmi - 28) + frame.familyHistory - frame.physicallyActive
    )
    frame["diabetes"] = (risk + rng.normal(0, 1, size) > 1).astype(int)
    return frame


def test_bang_points_match_ada_risk_and_ignore_gestational_diabetes():
    frame = cohort(4, 1).assign(
        ageYears=[30.0, 45.0, 55.0, 65.0],
        bmi=22.0,
        male=0.0,
        familyHistory=0.0,
        hypertension=0.0,
        physicallyActive=0.0,
        gestationalDiabetes=1.0,
    )
    assert nq.bang_points(frame).tolist() == [0, 1, 2, 3]


def test_leave_one_cycle_out_scores_every_candidate_on_each_held_cycle():
    scores = nq.leave_one_cycle_out(cohort(900, 2))
    assert set(scores) == {"bang", *nq.CANDIDATES}
    assert all(len(values) == len(nq.TRAIN_CYCLES) for values in scores.values())


def test_the_frozen_formula_reproduces_the_fitted_logistic_model():
    frame = cohort(600, 3)
    model = nq.fit_logistic(frame)
    formula = nq.frozen_form("logistic", model)
    assert np.allclose(nhanes_test.questionnaire_logit(formula, frame), nq.logit(model, frame))


def test_a_model_file_other_than_the_pre_registered_one_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(nhanes_test, "RUNS_DIR", tmp_path)
    (tmp_path / nq.MODEL_FILE).write_text(json.dumps({"chosen": "logistic"}), encoding="utf-8")
    with pytest.raises(nhanes_test.NhanesTestRefusedError):
        nhanes_test.frozen_model()


def test_the_held_out_cycle_is_tested_only_once(tmp_path, monkeypatch):
    monkeypatch.setattr(nhanes_test, "RUNS_DIR", tmp_path)
    monkeypatch.setattr("sys.argv", ["nhanes_test"])
    (tmp_path / nhanes_test.REPORT_FILE).write_text("{}", encoding="utf-8")
    with pytest.raises(nhanes_test.NhanesTestRefusedError):
        nhanes_test.main()


def test_the_report_compares_the_model_with_the_points_on_the_same_people():
    frame = cohort(800, 4)
    model = nq.fit_logistic(frame)
    frozen = {"model": nq.frozen_form("logistic", model), "threshold": 0.0}
    report = nhanes_test.report(frozen, frame)
    assert report["adults"] == 800 and report["positives"] == int(frame.diabetes.sum())
    assert report["deltaModelMinusBang"]["estimate"] == pytest.approx(
        report["model"]["estimate"] - report["bang"]["estimate"]
    )
    assert report["success"] == (report["deltaModelMinusBang"]["low"] > 0)
    assert report["model"]["undefinedResamples"] == 0


def test_parity_cases_carry_the_formula_logit_and_never_give_men_gestational_diabetes():
    frame = cohort(600, 5)
    frozen = {"model": nq.frozen_form("logistic", nq.fit_logistic(frame)), "threshold": 0.0}
    cases = nhanes_parity.parity_cases(frozen)
    replayed = nhanes_test.questionnaire_logit(frozen["model"], pd.DataFrame(cases))
    assert np.allclose(replayed, [case["logit"] for case in cases])
    assert all(case["higherRisk"] == (case["logit"] >= 0.0) for case in cases)
    assert not any(case["male"] and case["gestationalDiabetes"] for case in cases)


def test_the_cut_matches_the_specificity_of_bang_five_or_more():
    labels = np.array([0] * 10 + [1] * 2)
    points = np.array([0, 1, 2, 3, 4, 5, 6, 7, 1, 2, 6, 7])
    logits = np.arange(12, dtype=float)
    cut = nq.matched_specificity_threshold(points, logits, labels)
    assert np.mean(logits[labels == 0] < cut) == pytest.approx(
        np.mean(points[labels == 0] < nq.BANG_FLAG), abs=0.1
    )
