import assert from 'node:assert/strict';
import { test } from 'node:test';
import { externalTestReasons } from './proof/m3.mjs';

const complete = (sqi) => ({
  rhythm: { sensitivity: 0.9, specificity: 0.9, auroc: 0.95, ci95: [0.9, 0.97], ppvNpv: [] },
  sqi,
  diabetes: {
    auroc: 0.8,
    sensitivity: 0.7,
    specificity: 0.9,
    ci95: [0.7, 0.85],
    ppvNpv: [],
    floorMet: true,
  },
});
const ml4 = (external) => externalTestReasons(external).filter((reason) => reason.includes('ML-4'));

test('a gap within 5 points either way passes ML-4', () => {
  assert.deepEqual(ml4(complete({ rhythmBiasGapPts: 3, passed: true })), []);
  assert.deepEqual(ml4(complete({ rhythmBiasGapPts: -4, passed: true })), []);
  assert.deepEqual(externalTestReasons(complete({ rhythmBiasGapPts: 0, passed: true })), []);
});

test('a large negative gap fails ML-4 (SQI-Net accepting far more AF windows)', () => {
  assert.equal(ml4(complete({ rhythmBiasGapPts: -30, passed: true })).length, 1);
});

test('a null or missing gap fails ML-4', () => {
  assert.equal(ml4(complete({ rhythmBiasGapPts: null, passed: true })).length, 1);
  assert.equal(ml4(complete({ passed: true })).length, 1);
});

test('sqi.passed must be true', () => {
  assert.equal(ml4(complete({ rhythmBiasGapPts: 1, passed: false })).length, 1);
  assert.equal(ml4(complete({ rhythmBiasGapPts: 1 })).length, 1);
});

test('missing rhythm and diabetes fields still fail ML-1 and ML-6', () => {
  const reasons = externalTestReasons({ sqi: { rhythmBiasGapPts: 1, passed: true } });
  assert.equal(reasons.filter((reason) => reason.includes('(ML-1)')).length, 5);
  assert.equal(reasons.filter((reason) => reason.includes('(ML-6)')).length, 6);
  assert.equal(externalTestReasons(null).length, 13);
});

test('floorMet true below the ML-6 floor fails', () => {
  const external = complete({ rhythmBiasGapPts: 1, passed: true });
  external.diabetes.auroc = 0.7;
  assert.deepEqual(externalTestReasons(external), [
    'diabetes.floorMet is true but the numbers are below the ML-6 floor',
  ]);
});
