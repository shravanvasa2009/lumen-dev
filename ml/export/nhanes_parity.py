import argparse
import itertools
import json
from pathlib import Path

import pandas as pd

from eval.nhanes_test import FROZEN_SHA256, frozen_model, questionnaire_logit

# ADR 0091 (proposed): the frozen questionnaire formula plus answer/logit pairs, so @lumen/core's twin can be
# checked number for number. Ages and BMIs straddle Bang's band edges, where banded and smooth scores differ.
AGES = (20, 39.5, 40, 49, 50, 59, 60, 75, 90)
BMIS = (18.5, 24.9, 25, 29.9, 30, 39.9, 40, 55)
YES_NO = (0.0, 1.0)


def parity_cases(formula: dict) -> list[dict]:
    rows = [
        {
            "ageYears": age,
            "male": male,
            "bmi": bmi,
            "familyHistory": family,
            "hypertension": pressure,
            "physicallyActive": active,
            "gestationalDiabetes": gestational,
        }
        for age, bmi in itertools.product(AGES, BMIS)
        for male, family, pressure, active, gestational in itertools.product(YES_NO, repeat=5)
        if not (male and gestational)
    ]
    frame = pd.DataFrame(rows)
    logits = questionnaire_logit(formula, frame)
    return [{**row, "logit": float(value)} for row, value in zip(rows, logits, strict=True)]


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m export.nhanes_parity")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    # No threshold: under ML-6 the check is Experimental and never flags high or low (ADR 0091, choice 91-1).
    formula = frozen_model()["model"]
    document = {"modelSha256": FROZEN_SHA256, "formula": formula, "cases": parity_cases(formula)}
    args.out.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    logits = [case["logit"] for case in document["cases"]]
    print(f"{len(logits)} cases, logit range {min(logits):.2f}..{max(logits):.2f}")


if __name__ == "__main__":
    main()
