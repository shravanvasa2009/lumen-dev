import { DSP_CONFIG } from '@lumen/core';
import type { TFunction } from 'i18next';

import en from '@/i18n/en.json';

import {
  CHECK_IDS,
  type CheckCell,
  type CheckId,
  checkCell,
  type PlanMode,
  type PlanPhone,
  planPhone,
  UNRATED_PHONE,
} from './checkPlan';
import { lockText } from './lockText';

const phone = (tier: PlanPhone['tier'], over: Partial<PlanPhone> = {}): PlanPhone => ({
  tier,
  ambient: false,
  fps60: tier === 'full',
  ...over,
});
const state = (mode: PlanMode, check: CheckId, who: PlanPhone) => checkCell(mode, check, who).state;
const row = (mode: PlanMode, who: PlanPhone) => CHECK_IDS.map((check) => state(mode, check, who));
const why = (mode: PlanMode, check: CheckId, who: PlanPhone) => {
  const cell = checkCell(mode, check, who);
  return cell.state === 'locked' ? cell.why : null;
};
const text = (reason: Parameters<typeof lockText>[1]) =>
  lockText(((key: keyof typeof en) => en[key]) as unknown as TFunction, reason);

describe('which checks each mode runs (spec 12 Modes, spec 06 6.2)', () => {
  it('runs AFib, HRV and Diabetes in a Full Scan and leaves POTS to the Standing test', () => {
    expect(row('full', phone('full'))).toEqual(['runs', 'runs', 'runs', 'notInScan']);
    expect(row('standing', phone('full'))).toEqual(['notInScan', 'notInScan', 'notInScan', 'runs']);
  });

  it('runs only HRV in Deep HRV', () => {
    expect(row('deep', phone('full'))).toEqual(['notInScan', 'runs', 'notInScan', 'notInScan']);
  });

  it('keeps AFib out of a 30 s Quick Check, because the rhythm check needs 60 s (owner decision a)', () => {
    expect(row('quick', phone('full'))).toEqual(['notInScan', 'notInScan', 'notInScan', 'notInScan']);
  });
});

describe('what each rating tier locks, and why (spec 05 5.2)', () => {
  it('keeps everything open for a phone with no rating yet', () => {
    expect(row('full', UNRATED_PHONE)).toEqual(['runs', 'runs', 'runs', 'notInScan']);
  });

  it('Basic at 30 fps: HRV and Diabetes say the frame rate; AFib stays open', () => {
    const basic = phone('basic');
    expect(row('full', basic)).toEqual(['runs', 'locked', 'locked', 'notInScan']);
    expect(text(why('full', 'hrv', basic)!)).toBe(en['mode.locked60fps']);
    expect(text(why('full', 'diabetes', basic)!)).toBe(en['mode.locked60fps']);
  });

  it('Basic at 60 fps: HRV and Diabetes say the phone must be rated Full, not the frame rate', () => {
    const basic60 = phone('basic', { fps60: true });
    expect(text(why('full', 'hrv', basic60)!)).toBe(en['mode.lockedFull']);
    expect(text(why('full', 'diabetes', basic60)!)).toBe(en['mode.lockedFull']);
  });

  it('Basic keeps the Standing test open', () => {
    expect(state('standing', 'pots', phone('basic'))).toBe('runs');
  });

  it('Limited that films at 60 fps with a flash that works: HRV and Diabetes say Full, POTS says Basic or Full', () => {
    const limited60 = phone('limited', { fps60: true });
    expect(text(why('full', 'hrv', limited60)!)).toBe(en['mode.lockedFull']);
    expect(text(why('standing', 'pots', limited60)!)).toBe(en['mode.lockedBasic']);
  });

  it('Limited at 30 fps: HRV says the frame rate, POTS and AFib say Basic or Full (never 60 fps)', () => {
    const limited = phone('limited');
    expect(text(why('full', 'hrv', limited)!)).toBe(en['mode.locked60fps']);
    expect(text(why('standing', 'pots', limited)!)).toBe(en['mode.lockedBasic']);
    expect(text(why('full', 'afib', limited)!)).toBe(en['mode.lockedBasic']);
  });

  it('Limited because the flash does not reach the finger: every locked check says the flash', () => {
    const noFlash = phone('limited', { ambient: true, fps60: true });
    expect(text(why('full', 'hrv', noFlash)!)).toBe(en['mode.lockedFlash']);
    expect(text(why('full', 'diabetes', noFlash)!)).toBe(en['mode.lockedFlash']);
    expect(text(why('standing', 'pots', noFlash)!)).toBe(en['mode.lockedFlash']);
    expect(text(why('full', 'afib', noFlash)!)).toBe(en['mode.lockedFlash']);
  });

  it('a flash-less phone at 30 fps says the flash, not the frame rate, as the mode picker does', () => {
    const noFlash30 = phone('limited', { ambient: true, fps60: false });
    expect(why('full', 'hrv', noFlash30)).toBe('flash');
    expect(why('deep', 'hrv', noFlash30)).toBe('flash');
  });

  it('keeps AFib a check Limited owns, though the Full Scan holding it is locked (owner decision b)', () => {
    expect(why('full', 'afib', phone('limited'))).toBe('basic');
  });

  it('unsupported: every listed check says Lumen cannot measure a pulse', () => {
    const none = phone('unsupported');
    expect(row('full', none)).toEqual(['locked', 'locked', 'locked', 'notInScan']);
    expect(text(why('full', 'hrv', none)!)).toBe(en['mode.lockedUnsupported']);
  });

  it('Deep HRV below Full says the frame rate on a 30 fps phone and opens on Full', () => {
    expect(why('deep', 'hrv', phone('basic'))).toBe('fps60');
    expect(state('deep', 'hrv', phone('full'))).toBe('runs');
  });
});

describe('planPhone', () => {
  it('reads tier, ambient mode and the 60 fps level from the stored rating', () => {
    expect(planPhone(null)).toEqual(UNRATED_PHONE);
    const stored = { tier: 'limited', ambient: true, fpsLevel: 60 } as Parameters<typeof planPhone>[0];
    expect(planPhone(stored)).toEqual({ tier: 'limited', ambient: true, fps60: true });
    const slow = { tier: 'basic', ambient: false, fpsLevel: 30 } as Parameters<typeof planPhone>[0];
    expect(planPhone(slow).fps60).toBe(false);
  });
});

describe('clean seconds each check needs (spec 06 6.2, DSP_CONFIG)', () => {
  it('reads the thresholds from the config', () => {
    const seconds = (mode: PlanMode, check: CheckId) => {
      const cell: CheckCell = checkCell(mode, check, phone('full'));
      return cell.state === 'runs' ? cell.cleanSeconds : undefined;
    };
    expect(seconds('full', 'afib')).toBe(DSP_CONFIG.rules.rhythmMinCleanS);
    expect(seconds('full', 'hrv')).toBe(DSP_CONFIG.dsp12.rmssdMinCleanS);
    expect(seconds('deep', 'hrv')).toBe(DSP_CONFIG.dsp12.sdnnMinCleanS);
    expect(seconds('full', 'diabetes')).toBe(DSP_CONFIG.rules.diabetesMinCleanS);
    expect(seconds('standing', 'pots')).toBeNull();
  });
});
