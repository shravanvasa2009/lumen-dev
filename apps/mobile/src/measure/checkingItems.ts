import { DSP_CONFIG, type RatingMode } from '@lumen/core';

import { cleanSecondsNeeded, type MeasureMode } from './mode';

type CheckId = 'afib' | 'hrv' | 'diabetes';
type CheckState = 'ready' | 'checking' | 'unavailable';
export type CheckingItem = { id: CheckId; state: CheckState };

// Clean seconds each check needs, from the same config the decision rules read (spec 06 section 6.2).
const CLEAN_SECONDS_NEEDED: Record<CheckId, number> = {
  afib: DSP_CONFIG.rules.rhythmMinCleanS,
  hrv: DSP_CONFIG.dsp12.rmssdMinCleanS,
  diabetes: DSP_CONFIG.rules.diabetesMinCleanS,
};

// The rating row each check needs (spec 05 section 5.2); HRV and diabetes need the 60 fps rows.
const REQUIRED_UNLOCK: Record<CheckId, RatingMode> = {
  afib: 'rhythmFlags',
  hrv: 'hrv',
  diabetes: 'diabetes',
};

// Quick Check runs the rhythm check only; POTS is the Standing test and never a capture-screen check (spec 12).
const CHECKS_IN_MODE: Record<MeasureMode, readonly CheckId[]> = {
  quick: ['afib'],
  full: ['afib', 'hrv', 'diabetes'],
};

// A check lights once the session's clean seconds reach its threshold. A mode that ends before that
// threshold (Quick's 30 s against the 60 s rhythm rule) lights its check when the mode completes, because
// nothing more can be collected. A phone not yet rated keeps every check open, as the mode list does.
export function checkingItems(
  mode: MeasureMode,
  cleanSeconds: number | null,
  unlocks: readonly RatingMode[] | null | undefined,
): CheckingItem[] {
  const total = cleanSecondsNeeded(mode);
  return CHECKS_IN_MODE[mode].map((id) => {
    if (unlocks && !unlocks.includes(REQUIRED_UNLOCK[id])) return { id, state: 'unavailable' };
    const needed = Math.min(CLEAN_SECONDS_NEEDED[id], total);
    return { id, state: cleanSeconds !== null && cleanSeconds >= needed ? 'ready' : 'checking' };
  });
}
