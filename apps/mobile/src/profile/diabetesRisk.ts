export type Sex = 'female' | 'male' | 'preferNot';

export type RiskDraft = {
  ageYears: number | null;
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  familyHistory: boolean | null;
  hypertension: boolean | null;
  physicallyActive: boolean | null;
  // Asked for context only; it never reaches the score.
  gestationalDiabetes: boolean | null;
};

export const EMPTY_RISK_DRAFT: RiskDraft = {
  ageYears: null,
  sex: null,
  heightCm: null,
  weightKg: null,
  familyHistory: null,
  hypertension: null,
  physicallyActive: null,
  gestationalDiabetes: null,
};

// Spec §8.2 step 3: the tutorial passes once an age of 13 or more is entered.
export const MIN_APP_AGE = 13;

export const HEIGHT_CM = { min: 100, max: 250 } as const;
export const WEIGHT_KG = { min: 20, max: 300 } as const;
// The ranges @lumen/core's adaRisk accepts; outside them it rejects the answers.
const AGE_YEARS = { min: 0, max: 130 } as const;
const BMI = { min: 10, max: 100 } as const;

const CM_PER_INCH = 2.54;
const KG_PER_POUND = 0.45359237;

export const cmFromInches = (inches: number) => inches * CM_PER_INCH;
export const inchesFromCm = (cm: number) => cm / CM_PER_INCH;
export const kgFromPounds = (pounds: number) => pounds * KG_PER_POUND;
export const poundsFromKg = (kg: number) => kg / KG_PER_POUND;

export const bmiOf = (heightCm: number, weightKg: number) => weightKg / (heightCm / 100) ** 2;

type RiskField = 'age' | 'height' | 'weight' | 'bmi';

// The field names match the AdaAnswers type in @lumen/core; an exported core type replaces this one.
type RiskAnswers = {
  ageYears: number;
  male: boolean;
  familyHistory: boolean;
  hypertension: boolean;
  physicallyActive: boolean;
  bmi: number;
};

export type RiskAssessment =
  | { status: 'incomplete' }
  | { status: 'invalid'; fields: readonly RiskField[] }
  // sexNotGiven is true for "Prefer not": the answers then carry male: false, but the sex point was not
  // counted, so the score is a minimum.
  | { status: 'ready'; answers: RiskAnswers; sexNotGiven: boolean };

const within = (value: number, range: { min: number; max: number }) =>
  Number.isFinite(value) && value >= range.min && value <= range.max;

// A value that is present but out of range is reported even while other answers are still missing, so
// the person sees the problem as they type.
export function assessRisk(draft: RiskDraft): RiskAssessment {
  const { ageYears, heightCm, weightKg } = draft;
  const invalid: RiskField[] = [];
  if (ageYears !== null && !within(ageYears, AGE_YEARS)) invalid.push('age');
  if (heightCm !== null && !within(heightCm, HEIGHT_CM)) invalid.push('height');
  if (weightKg !== null && !within(weightKg, WEIGHT_KG)) invalid.push('weight');
  const bodyKnown =
    heightCm !== null && weightKg !== null && !invalid.includes('height') && !invalid.includes('weight');
  const bmi = bodyKnown ? bmiOf(heightCm, weightKg) : null;
  if (bmi !== null && !within(bmi, BMI)) invalid.push('bmi');
  if (invalid.length > 0) return { status: 'invalid', fields: invalid };
  const { sex, familyHistory, hypertension, physicallyActive } = draft;
  if (
    ageYears === null ||
    sex === null ||
    bmi === null ||
    familyHistory === null ||
    hypertension === null ||
    physicallyActive === null
  )
    return { status: 'incomplete' };
  // "Prefer not" is not male, so it does not add the male point.
  return {
    status: 'ready',
    answers: { ageYears, male: sex === 'male', familyHistory, hypertension, physicallyActive, bmi },
    sexNotGiven: sex === 'preferNot',
  };
}

// Out-of-range numbers are never stored: what is on disk is what a risk check could use.
export function storableDraft(draft: RiskDraft): RiskDraft {
  const assessment = assessRisk(draft);
  const dropped = assessment.status === 'invalid' ? assessment.fields : [];
  return {
    ...draft,
    ageYears: dropped.includes('age') ? null : draft.ageYears,
    heightCm: dropped.includes('height') ? null : draft.heightCm,
    weightKg: dropped.includes('weight') ? null : draft.weightKg,
  };
}

// Continue is open once the age is one the app accepts and nothing typed is out of range; height and
// weight may stay empty.
export function basicsAcceptable(draft: RiskDraft): boolean {
  return draft.ageYears !== null && draft.ageYears >= MIN_APP_AGE && assessRisk(draft).status !== 'invalid';
}
