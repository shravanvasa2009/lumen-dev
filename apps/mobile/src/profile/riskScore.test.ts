import * as core from '@lumen/core';

import { EMPTY_RISK_DRAFT, type RiskDraft } from './diabetesRisk';
import { scoreDraft } from './riskScore';

jest.mock('@lumen/core', () => {
  const actual = jest.requireActual<typeof import('@lumen/core')>('@lumen/core');
  return { ...actual, adaRisk: jest.fn(actual.adaRisk) };
});

const complete: RiskDraft = {
  ageYears: 52,
  sex: 'female',
  heightCm: 168,
  weightKg: 82,
  familyHistory: true,
  hypertension: true,
  physicallyActive: false,
  gestationalDiabetes: false,
};

beforeEach(() => jest.mocked(core.adaRisk).mockClear());

describe('scoreDraft', () => {
  it('never calls adaRisk while answers are missing', () => {
    expect(scoreDraft(EMPTY_RISK_DRAFT)).toEqual({ kind: 'notReady' });
    expect(scoreDraft({ ...complete, physicallyActive: null })).toEqual({ kind: 'notReady' });
    expect(core.adaRisk).not.toHaveBeenCalled();
  });

  it('never calls adaRisk for out-of-range or untyped numbers', () => {
    expect(scoreDraft({ ...complete, heightCm: 40 })).toEqual({ kind: 'notReady' });
    expect(scoreDraft({ ...complete, ageYears: 200 })).toEqual({ kind: 'notReady' });
    expect(scoreDraft({ ...complete, weightKg: Number.NaN })).toEqual({ kind: 'notReady' });
    expect(scoreDraft({ ...complete, ageYears: '52' as unknown as number })).toEqual({ kind: 'notReady' });
    expect(core.adaRisk).not.toHaveBeenCalled();
  });

  it('scores a ready draft once and flags 5 points', () => {
    const score = scoreDraft(complete);
    expect(core.adaRisk).toHaveBeenCalledTimes(1);
    expect(score).toMatchObject({ kind: 'scored', sexNotGiven: false, pregnancyAnswered: true });
    if (score.kind !== 'scored') throw new Error('expected a score');
    expect(score.risk.points).toBe(5);
    expect(score.risk.flagged).toBe(true);
  });

  it('gives no score under 20', () => {
    expect(scoreDraft({ ...complete, ageYears: 15 })).toEqual({ kind: 'under20' });
  });

  it('marks Prefer not as a minimum and lists the pregnancy row for Female only', () => {
    expect(scoreDraft({ ...complete, sex: 'preferNot' })).toMatchObject({
      kind: 'scored',
      sexNotGiven: true,
      pregnancyAnswered: false,
    });
    expect(scoreDraft({ ...complete, gestationalDiabetes: null })).toMatchObject({
      pregnancyAnswered: false,
    });
  });
});
