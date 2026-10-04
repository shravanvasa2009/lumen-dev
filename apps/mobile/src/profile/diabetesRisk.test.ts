import {
  assessRisk,
  basicsAcceptable,
  bmiOf,
  cmFromInches,
  EMPTY_RISK_DRAFT,
  inchesFromCm,
  kgFromPounds,
  poundsFromKg,
  type RiskDraft,
  storableDraft,
} from './diabetesRisk';

const complete: RiskDraft = {
  ageYears: 52,
  sex: 'female',
  heightCm: 168,
  weightKg: 82,
  familyHistory: true,
  hypertension: true,
  physicallyActive: false,
  gestationalDiabetes: null,
};

describe('body mass index', () => {
  it('is kilograms over metres squared', () => {
    expect(bmiOf(168, 82)).toBeCloseTo(29.05, 2);
    expect(bmiOf(200, 80)).toBe(20);
  });
});

describe('unit conversion', () => {
  it('converts inches and pounds to metric and back', () => {
    expect(cmFromInches(66)).toBeCloseTo(167.64, 2);
    expect(kgFromPounds(180)).toBeCloseTo(81.65, 2);
    expect(inchesFromCm(cmFromInches(70))).toBeCloseTo(70, 10);
    expect(poundsFromKg(kgFromPounds(150))).toBeCloseTo(150, 10);
  });
});

describe('assessRisk', () => {
  it('is incomplete while any scored answer is missing', () => {
    expect(assessRisk(EMPTY_RISK_DRAFT)).toEqual({ status: 'incomplete' });
    for (const field of [
      'ageYears',
      'sex',
      'heightCm',
      'weightKg',
      'familyHistory',
      'hypertension',
      'physicallyActive',
    ] as const)
      expect(assessRisk({ ...complete, [field]: null })).toEqual({ status: 'incomplete' });
  });

  it('does not need the pregnancy answer', () => {
    expect(assessRisk({ ...complete, gestationalDiabetes: null }).status).toBe('ready');
    expect(assessRisk({ ...complete, gestationalDiabetes: true }).status).toBe('ready');
  });

  it('is ready with answers shaped like the core AdaAnswers', () => {
    const assessment = assessRisk(complete);
    expect(assessment).toEqual({
      status: 'ready',
      answers: {
        ageYears: 52,
        male: false,
        familyHistory: true,
        hypertension: true,
        physicallyActive: false,
        bmi: bmiOf(168, 82),
      },
      sexNotGiven: false,
    });
  });

  it('counts Prefer not as not male, and Male as male', () => {
    const male = (sex: RiskDraft['sex']) => {
      const assessment = assessRisk({ ...complete, sex });
      return assessment.status === 'ready' ? assessment.answers.male : null;
    };
    expect(male('male')).toBe(true);
    expect(male('female')).toBe(false);
    expect(male('preferNot')).toBe(false);
  });

  it('flags Prefer not apart from Female, so the score can be shown as a minimum', () => {
    const flagged = (sex: RiskDraft['sex']) => {
      const assessment = assessRisk({ ...complete, sex });
      return assessment.status === 'ready' ? assessment.sexNotGiven : null;
    };
    expect(flagged('preferNot')).toBe(true);
    expect(flagged('female')).toBe(false);
    expect(flagged('male')).toBe(false);
    const notGiven = assessRisk({ ...complete, sex: 'preferNot' });
    expect(notGiven.status === 'ready' && notGiven.answers.male).toBe(false);
  });

  it('accepts the limits of height and weight and rejects values just outside them', () => {
    expect(assessRisk({ ...complete, heightCm: 100, weightKg: 30 }).status).toBe('ready');
    expect(assessRisk({ ...complete, heightCm: 250, weightKg: 300 }).status).toBe('ready');
    expect(assessRisk({ ...complete, heightCm: 99.9 })).toEqual({ status: 'invalid', fields: ['height'] });
    expect(assessRisk({ ...complete, heightCm: 250.1 })).toEqual({ status: 'invalid', fields: ['height'] });
    expect(assessRisk({ ...complete, weightKg: 19.9 })).toEqual({ status: 'invalid', fields: ['weight'] });
    expect(assessRisk({ ...complete, weightKg: 300.1 })).toEqual({ status: 'invalid', fields: ['weight'] });
  });

  it('rejects an age outside 0 to 130', () => {
    expect(assessRisk({ ...complete, ageYears: 0 }).status).toBe('ready');
    expect(assessRisk({ ...complete, ageYears: 130 }).status).toBe('ready');
    expect(assessRisk({ ...complete, ageYears: 131 })).toEqual({ status: 'invalid', fields: ['age'] });
    expect(assessRisk({ ...complete, ageYears: -1 })).toEqual({ status: 'invalid', fields: ['age'] });
  });

  it('rejects a body mass index outside 10 to 100 even when height and weight are each in range', () => {
    expect(assessRisk({ ...complete, heightCm: 250, weightKg: 20 })).toEqual({
      status: 'invalid',
      fields: ['bmi'],
    });
    expect(assessRisk({ ...complete, heightCm: 100, weightKg: 150 })).toEqual({
      status: 'invalid',
      fields: ['bmi'],
    });
  });

  it('reports a value that is out of range while other answers are still missing', () => {
    expect(assessRisk({ ...EMPTY_RISK_DRAFT, heightCm: 40 })).toEqual({
      status: 'invalid',
      fields: ['height'],
    });
  });
});

describe('storableDraft', () => {
  it('drops out-of-range numbers and keeps everything else', () => {
    expect(storableDraft({ ...complete, heightCm: 40, ageYears: 200 })).toEqual({
      ...complete,
      heightCm: null,
      ageYears: null,
    });
    expect(storableDraft(complete)).toEqual(complete);
  });

  it('keeps the pregnancy answer only for Female', () => {
    const answered = { ...complete, gestationalDiabetes: true };
    expect(storableDraft(answered).gestationalDiabetes).toBe(true);
    expect(storableDraft({ ...answered, sex: 'male' }).gestationalDiabetes).toBeNull();
    expect(storableDraft({ ...answered, sex: 'preferNot' }).gestationalDiabetes).toBeNull();
  });
});

describe('basicsAcceptable', () => {
  it('needs an age of 13 or more and nothing out of range, but not height or weight', () => {
    expect(basicsAcceptable(EMPTY_RISK_DRAFT)).toBe(false);
    expect(basicsAcceptable({ ...EMPTY_RISK_DRAFT, ageYears: 12 })).toBe(false);
    expect(basicsAcceptable({ ...EMPTY_RISK_DRAFT, ageYears: 13 })).toBe(true);
    expect(basicsAcceptable({ ...EMPTY_RISK_DRAFT, ageYears: 40, heightCm: 50 })).toBe(false);
  });
});
