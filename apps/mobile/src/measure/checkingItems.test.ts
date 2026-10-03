import { DSP_CONFIG, tierUnlocks } from '@lumen/core';

import { checkingItems } from './checkingItems';

const states = (items: ReturnType<typeof checkingItems>) => items.map(({ id, state }) => `${id}:${state}`);

describe('checkingItems', () => {
  const full = tierUnlocks('full');

  it('lists the three Full Scan checks and never POTS', () => {
    expect(checkingItems('full', null, full).map(({ id }) => id)).toEqual(['afib', 'hrv', 'diabetes']);
  });

  it('keeps every check pending before any clean seconds are counted', () => {
    expect(states(checkingItems('full', null, full))).toEqual([
      'afib:checking',
      'hrv:checking',
      'diabetes:checking',
    ]);
  });

  it('lights AFib and HRV at their clean-second thresholds and Diabetes at 90', () => {
    const rhythm = DSP_CONFIG.rules.rhythmMinCleanS;
    const hrv = DSP_CONFIG.dsp12.rmssdMinCleanS;
    const diabetes = DSP_CONFIG.rules.diabetesMinCleanS;
    expect(states(checkingItems('full', Math.min(rhythm, hrv) - 0.1, full))).toEqual([
      'afib:checking',
      'hrv:checking',
      'diabetes:checking',
    ]);
    expect(states(checkingItems('full', Math.max(rhythm, hrv), full))).toEqual([
      'afib:ready',
      'hrv:ready',
      'diabetes:checking',
    ]);
    expect(states(checkingItems('full', diabetes - 0.1, full))[2]).toBe('diabetes:checking');
    expect(states(checkingItems('full', diabetes, full))[2]).toBe('diabetes:ready');
  });

  it('shows Diabetes and HRV as unavailable on a Basic phone, however many clean seconds', () => {
    expect(states(checkingItems('full', 90, tierUnlocks('basic')))).toEqual([
      'afib:ready',
      'hrv:unavailable',
      'diabetes:unavailable',
    ]);
  });

  it('shows every check as unavailable on a Limited phone', () => {
    expect(states(checkingItems('full', 10, tierUnlocks('limited')))).toEqual([
      'afib:unavailable',
      'hrv:unavailable',
      'diabetes:unavailable',
    ]);
  });

  it('keeps every check open on a phone with no rating yet', () => {
    expect(states(checkingItems('full', 5, null))).toEqual([
      'afib:checking',
      'hrv:checking',
      'diabetes:checking',
    ]);
    expect(states(checkingItems('full', 5, undefined))[2]).toBe('diabetes:checking');
  });

  it('runs only the rhythm check in Quick Check, lit when the 30 s complete', () => {
    expect(states(checkingItems('quick', 29.9, full))).toEqual(['afib:checking']);
    expect(states(checkingItems('quick', 30, full))).toEqual(['afib:ready']);
  });
});
