import { DSP_CONFIG } from '@lumen/core';

import {
  CHECK_IDS,
  type CheckCell,
  type CheckId,
  checkCell,
  type PlanMode,
  type PlanTier,
} from './checkPlan';

const state = (mode: PlanMode, check: CheckId, tier: PlanTier) => checkCell(mode, check, tier).state;
const row = (mode: PlanMode, tier: PlanTier) => CHECK_IDS.map((check) => state(mode, check, tier));

describe('which checks each mode runs (spec 12 Modes, spec 06 6.2)', () => {
  it('runs AFib, HRV and Diabetes in a Full Scan and leaves POTS to the Standing test', () => {
    expect(row('full', 'full')).toEqual(['runs', 'runs', 'runs', 'notInScan']);
    expect(row('standing', 'full')).toEqual(['notInScan', 'notInScan', 'notInScan', 'runs']);
  });

  it('runs only HRV in Deep HRV', () => {
    expect(row('deep', 'full')).toEqual(['notInScan', 'runs', 'notInScan', 'notInScan']);
  });

  it('keeps AFib out of a 30 s Quick Check, because the rhythm check needs 60 s (owner decision a)', () => {
    expect(row('quick', 'full')).toEqual(['notInScan', 'notInScan', 'notInScan', 'notInScan']);
  });
});

describe('what each rating tier locks (spec 05 5.2)', () => {
  it('keeps everything open for a phone with no rating yet', () => {
    expect(row('full', 'unrated')).toEqual(['runs', 'runs', 'runs', 'notInScan']);
  });

  it('locks HRV and Diabetes on a Basic phone with the 60 fps reason, and keeps AFib', () => {
    expect(row('full', 'basic')).toEqual(['runs', 'locked', 'locked', 'notInScan']);
    expect(checkCell('full', 'hrv', 'basic')).toEqual({ state: 'locked', why: 'fps60' });
    expect(checkCell('full', 'diabetes', 'basic')).toEqual({ state: 'locked', why: 'fps60' });
  });

  it('keeps the Standing test open on a Basic phone and locks it on a Limited one without the 60 fps reason', () => {
    expect(state('standing', 'pots', 'basic')).toBe('runs');
    expect(checkCell('standing', 'pots', 'limited')).toEqual({ state: 'locked', why: 'basic' });
  });

  it('locks the whole Full Scan on a Limited phone; AFib is still a check Limited keeps (owner decision b)', () => {
    expect(checkCell('full', 'hrv', 'limited')).toEqual({ state: 'locked', why: 'fps60' });
    expect(checkCell('full', 'afib', 'limited')).toEqual({ state: 'locked', why: 'basic' });
  });

  it('locks every listed check on an unsupported phone', () => {
    expect(row('full', 'unsupported')).toEqual(['locked', 'locked', 'locked', 'notInScan']);
  });

  it('locks Deep HRV below Full', () => {
    expect(checkCell('deep', 'hrv', 'basic')).toEqual({ state: 'locked', why: 'fps60' });
    expect(state('deep', 'hrv', 'full')).toBe('runs');
  });
});

describe('clean seconds each check needs (spec 06 6.2, DSP_CONFIG)', () => {
  it('reads the thresholds from the config', () => {
    const seconds = (mode: PlanMode, check: CheckId) => {
      const cell: CheckCell = checkCell(mode, check, 'full');
      return cell.state === 'runs' ? cell.cleanSeconds : undefined;
    };
    expect(seconds('full', 'afib')).toBe(DSP_CONFIG.rules.rhythmMinCleanS);
    expect(seconds('full', 'hrv')).toBe(DSP_CONFIG.dsp12.rmssdMinCleanS);
    expect(seconds('deep', 'hrv')).toBe(DSP_CONFIG.dsp12.sdnnMinCleanS);
    expect(seconds('full', 'diabetes')).toBe(DSP_CONFIG.rules.diabetesMinCleanS);
    expect(seconds('standing', 'pots')).toBeNull();
  });
});
