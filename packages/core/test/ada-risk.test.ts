import { adaRisk, type AdaAnswers } from '../src';

// Ported case for case from ml/tests/test_ada_risk.py (ADR 0087), so the app scores answers as Lumen's
// evaluation does.
const score = (changes: Partial<AdaAnswers> = {}) =>
  adaRisk({
    ageYears: 35,
    male: false,
    familyHistory: false,
    hypertension: false,
    physicallyActive: false,
    bmi: 22,
    ...changes,
  });

describe('adaRisk (Bang 2009 points, twin of ml/train/ada_risk.py)', () => {
  it.each([
    [20, 0],
    [39, 0],
    [40, 1],
    [49, 1],
    [50, 2],
    [59, 2],
    [60, 3],
    [90, 3],
  ])('age %d scores %d', (ageYears, points) => {
    expect(score({ ageYears })?.points).toBe(points);
  });

  it.each([
    [24.99, 0],
    [25, 1],
    [29.99, 1],
    [30, 2],
    [39.99, 2],
    [40, 3],
  ])('BMI %d scores %d', (bmi, points) => {
    expect(score({ bmi })?.points).toBe(points);
  });

  it('each yes answer adds one and activity takes one away', () => {
    expect(score({ male: true })?.points).toBe(1);
    expect(score({ familyHistory: true })?.points).toBe(1);
    expect(score({ hypertension: true })?.points).toBe(1);
    expect(score({ physicallyActive: true })?.points).toBe(-1);
  });

  it('ranges from -1 to 9', () => {
    const lowest = score({ ageYears: 20, physicallyActive: true, bmi: 18 });
    const highest = score({ ageYears: 70, male: true, familyHistory: true, hypertension: true, bmi: 45 });
    expect([lowest?.points, highest?.points]).toEqual([-1, 9]);
  });

  it('flags at 5 points or more', () => {
    expect(score({ ageYears: 60, male: true })).toEqual({ points: 4, flagged: false });
    expect(score({ ageYears: 60, male: true, hypertension: true })).toEqual({ points: 5, flagged: true });
  });

  it.each([0, 13, 17, 19])('age %d has no score: never validated under 20', (ageYears) => {
    expect(score({ ageYears })).toBeNull();
  });

  it.each([
    ['ageYears', -1],
    ['ageYears', 131],
    ['bmi', 9.9],
    ['bmi', 100.1],
    ['ageYears', Number.NaN],
    ['bmi', Number.NaN],
  ] as const)('refuses %s = %d', (field, value) => {
    expect(() => score({ [field]: value })).toThrow(RangeError);
  });
});
