import model from '../../../models/diabetes-questionnaire@1.0.0.json';
import { nhanesRisk, type NhanesAnswers, type QuestionnaireFormula } from '../src';

// ADR 0091 parity: every case python -m export.nhanes_parity wrote next to the frozen formula.
const formula = model.formula as QuestionnaireFormula;
const answers = (changes: Partial<NhanesAnswers> = {}): NhanesAnswers => ({
  ageYears: 45,
  male: false,
  familyHistory: false,
  hypertension: false,
  physicallyActive: false,
  bmi: 27,
  gestationalDiabetes: false,
  ...changes,
});

describe('nhanesRisk (twin of ml/eval/nhanes_test.py questionnaire_logit)', () => {
  it(`matches all ${model.cases.length} Python cases to 1e-9 on the logit`, () => {
    for (const { logit, ...row } of model.cases) {
      const risk = nhanesRisk(
        {
          ageYears: row.ageYears,
          male: row.male === 1,
          familyHistory: row.familyHistory === 1,
          hypertension: row.hypertension === 1,
          physicallyActive: row.physicallyActive === 1,
          bmi: row.bmi,
          gestationalDiabetes: row.gestationalDiabetes === 1,
        },
        formula,
      );
      expect(Math.abs(risk!.logit - logit)).toBeLessThan(1e-9);
    }
  });

  it('scores gestational diabetes as 0 for men, as in training', () => {
    expect(nhanesRisk(answers({ male: true, gestationalDiabetes: true }), formula)).toEqual(
      nhanesRisk(answers({ male: true }), formula),
    );
  });

  it('has no score under 20 and refuses what adaRisk refuses', () => {
    expect(nhanesRisk(answers({ ageYears: 19 }), formula)).toBeNull();
    expect(() => nhanesRisk(answers({ bmi: 9.9 }), formula)).toThrow(RangeError);
    expect(() => nhanesRisk(answers({ male: 1 as unknown as boolean }), formula)).toThrow(TypeError);
    expect(() =>
      nhanesRisk(answers({ gestationalDiabetes: undefined as unknown as boolean }), formula),
    ).toThrow(TypeError);
  });

  it('refuses a formula with another design', () => {
    expect(() => nhanesRisk(answers(), { ...formula, design: [...formula.design].reverse() })).toThrow(
      RangeError,
    );
  });
});
