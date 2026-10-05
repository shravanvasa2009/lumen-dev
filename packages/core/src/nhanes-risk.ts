import { isScorableAdult, type AdaAnswers } from './ada-risk';

// ADR 0091: the frozen NHANES questionnaire model, twin of ml/eval/nhanes_test.py `questionnaire_logit`. The
// coefficients live in models/diabetes-questionnaire@1.0.0.json (`formula`) and are passed in as loaded, never
// typed or rounded by hand. Experimental under ML-6: a logit only, no threshold, no percentage (ADR 0090 (d)/(e)).
const DESIGN = [
  'ageYears',
  'male',
  'bmi',
  'familyHistory',
  'hypertension',
  'physicallyActive',
  'gestationalDiabetes',
  'ageYears^2',
  'bmi^2',
] as const;

export interface NhanesAnswers extends AdaAnswers {
  gestationalDiabetes: boolean; // scored as 0 for men, as in training
}

export interface QuestionnaireFormula {
  kind: 'logistic';
  design: readonly string[];
  coef: readonly number[];
  mean: readonly number[];
  scale: readonly number[];
  intercept: number;
}

/** ADR 0091: the NHANES questionnaire model's logit; null under age 20, where it was never validated. */
export function nhanesRisk(answers: NhanesAnswers, formula: QuestionnaireFormula): { logit: number } | null {
  // A formula from another model or version would score silently wrong: refuse anything but this design.
  if (formula.kind !== 'logistic' || formula.design.join() !== DESIGN.join())
    throw new RangeError(`formula design must be ${DESIGN.join(', ')}, got ${formula.design.join(', ')}`);
  if (!isScorableAdult(answers)) return null;
  if (typeof answers.gestationalDiabetes !== 'boolean')
    throw new TypeError(`gestationalDiabetes must be true or false, got ${answers.gestationalDiabetes}`);
  const { ageYears, bmi } = answers;
  const x = [
    ageYears,
    Number(answers.male),
    bmi,
    Number(answers.familyHistory),
    Number(answers.hypertension),
    Number(answers.physicallyActive),
    answers.male ? 0 : Number(answers.gestationalDiabetes),
    ageYears ** 2,
    bmi ** 2,
  ];
  // Standardise, weight, sum, then add the intercept: Python's operation order.
  let weighted = 0;
  x.forEach((value, i) => {
    weighted += ((value - formula.mean[i]!) / formula.scale[i]!) * formula.coef[i]!;
  });
  return { logit: weighted + formula.intercept };
}
