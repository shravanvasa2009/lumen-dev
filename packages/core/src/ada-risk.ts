// ADR 0087: the diabetes risk questionnaire, scored with the ORIGINAL validated points of Bang et al. 2009
// (Ann Intern Med 151:775-783, Table 2; https://pmc.ncbi.nlm.nih.gov/articles/PMC3633111/). The CDC printable
// form adds a gestational-diabetes item and scores inactivity +1 instead of activity −1; neither change was
// validated, so the app may ask it but the score uses these points. Validated on US adults aged 20 or
// older without known diabetes. Twin of ml/train/ada_risk.py; the evaluation scores answers the same way.
const MIN_AGE_YEARS = 20;
const AGE_POINTS: readonly (readonly [number, number])[] = [
  [60, 3],
  [50, 2],
  [40, 1],
];
const BMI_POINTS: readonly (readonly [number, number])[] = [
  [40, 3],
  [30, 2],
  [25, 1],
];
const FLAG_AT = 5;

export interface AdaAnswers {
  ageYears: number;
  male: boolean;
  familyHistory: boolean; // a parent or sibling with diabetes
  hypertension: boolean;
  physicallyActive: boolean;
  bmi: number; // kg/m²
}

export interface AdaRisk {
  points: number; // −1..9
  flagged: boolean; // points ≥ 5: the cut-off Bang 2009 validated for undiagnosed diabetes
}

const pointsFor = (value: number, table: readonly (readonly [number, number])[]) =>
  table.find(([threshold]) => value >= threshold)?.[1] ?? 0;

/** ADR 0087: Bang 2009 diabetes risk points; null under age 20, where the score was never validated. */
export function adaRisk(answers: AdaAnswers): AdaRisk | null {
  const { ageYears, bmi } = answers;
  // Negated so NaN is refused, as Python's chained comparison refuses it.
  if (!(ageYears >= 0 && ageYears <= 130)) throw new RangeError(`ageYears must be 0-130, got ${ageYears}`);
  if (!(bmi >= 10 && bmi <= 100)) throw new RangeError(`bmi must be 10-100 kg/m², got ${bmi}`);
  if (ageYears < MIN_AGE_YEARS) return null;
  const points =
    pointsFor(ageYears, AGE_POINTS) +
    Number(answers.male) +
    Number(answers.familyHistory) +
    Number(answers.hypertension) -
    Number(answers.physicallyActive) +
    pointsFor(bmi, BMI_POINTS);
  return { points, flagged: points >= FLAG_AT };
}
