import { DSP_CONFIG } from '@lumen/core';

import { type PlanPhone, UNRATED_PHONE } from '@/checks/checkPlan';

import { checkingItems } from './checkingItems';

const states = (items: ReturnType<typeof checkingItems>) => items.map(({ id, state }) => `${id}:${state}`);

describe('checkingItems', () => {
  const full: PlanPhone = { tier: 'full', ambient: false, fps60: true };
  const basic: PlanPhone = { tier: 'basic', ambient: false, fps60: false };
  const limited: PlanPhone = { tier: 'limited', ambient: false, fps60: false };
  const rhythm = DSP_CONFIG.rules.rhythmMinCleanS;
  const hrv = DSP_CONFIG.dsp12.rmssdMinCleanS;
  const diabetes = DSP_CONFIG.rules.diabetesMinCleanS;

  it('lists POTS in a Full Scan as a check that is not in the scan', () => {
    expect(states(checkingItems('full', null, full))).toEqual([
      'afib:checking',
      'hrv:checking',
      'diabetes:checking',
      'pots:off',
    ]);
  });

  it('never lights POTS, however many clean seconds', () => {
    expect(checkingItems('full', 1000, full).find(({ id }) => id === 'pots')?.state).toBe('off');
  });

  it('lights AFib and HRV at their thresholds and Diabetes at its own', () => {
    expect(states(checkingItems('full', Math.min(rhythm, hrv) - 0.1, full)).slice(0, 3)).toEqual([
      'afib:checking',
      'hrv:checking',
      'diabetes:checking',
    ]);
    expect(states(checkingItems('full', Math.max(rhythm, hrv), full)).slice(0, 3)).toEqual([
      'afib:ready',
      'hrv:ready',
      'diabetes:checking',
    ]);
    expect(states(checkingItems('full', diabetes - 0.1, full))[2]).toBe('diabetes:checking');
    expect(states(checkingItems('full', diabetes, full))[2]).toBe('diabetes:ready');
  });

  it('shows HRV and Diabetes as unavailable on a Basic phone, however many clean seconds', () => {
    expect(states(checkingItems('full', 90, basic)).slice(0, 3)).toEqual([
      'afib:ready',
      'hrv:unavailable',
      'diabetes:unavailable',
    ]);
  });

  it('shows all three as unavailable on a Limited phone', () => {
    expect(states(checkingItems('full', 10, limited)).slice(0, 3)).toEqual([
      'afib:unavailable',
      'hrv:unavailable',
      'diabetes:unavailable',
    ]);
  });

  it('keeps every check open on a phone with no rating yet', () => {
    expect(states(checkingItems('full', 5, UNRATED_PHONE)).slice(0, 3)).toEqual([
      'afib:checking',
      'hrv:checking',
      'diabetes:checking',
    ]);
    expect(states(checkingItems('full', 5, UNRATED_PHONE))[2]).toBe('diabetes:checking');
  });

  it('lists no check in a Quick Check, because the rhythm check needs 60 s and Quick is 30 s (ADR 0089)', () => {
    expect(rhythm).toBeGreaterThan(30);
    for (const seconds of [0, 30, 45]) {
      expect(states(checkingItems('quick', seconds, full))).toEqual([
        'afib:off',
        'hrv:off',
        'diabetes:off',
        'pots:off',
      ]);
    }
  });
});
