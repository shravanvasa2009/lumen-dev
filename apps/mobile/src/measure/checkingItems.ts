import { DSP_CONFIG, type RatingMode } from '@lumen/core';

import { cleanSecondsNeeded, type MeasureMode } from './mode';

type CheckId = 'afib' | 'hrv' | 'diabetes' | 'pots';
// 'off' is a check this mode never runs, shown as "Not in this scan".
type CheckState = 'ready' | 'checking' | 'unavailable' | 'off';
export type CheckingItem = { id: CheckId; state: CheckState };

// Clean seconds each check needs, from the same config the decision rules read (spec 06 section 6.2).
const CLEAN_SECONDS_NEEDED = {
  afib: DSP_CONFIG.rules.rhythmMinCleanS,
  hrv: DSP_CONFIG.dsp12.rmssdMinCleanS,
  diabetes: DSP_CONFIG.rules.diabetesMinCleanS,
} as const;

// The rating row each check needs (spec 05 section 5.2); HRV and diabetes need the 60 fps rows.
const REQUIRED_UNLOCK = { afib: 'rhythmFlags', hrv: 'hrv', diabetes: 'diabetes' } as const satisfies Record<
  keyof typeof CLEAN_SECONDS_NEEDED,
  RatingMode
>;

// Quick Check runs the rhythm check only; POTS is the Standing test and never a capture-screen check (spec 12).
const CHECKS_IN_MODE: Record<MeasureMode, readonly CheckId[]> = {
  quick: ['afib'],
  full: ['afib', 'hrv', 'diabetes'],
};

const ALL_CHECKS: readonly CheckId[] = ['afib', 'hrv', 'diabetes', 'pots'];

// A check lights once the session's clean seconds reach its threshold. A threshold longer than the mode
// (Quick's 30 s against the 60 s rhythm rule) is never reached, so that check keeps reading Checking: no
// result exists below the threshold. A phone not yet rated keeps every check open, as the mode list does.
export function checkingItems(
  mode: MeasureMode,
  cleanSeconds: number | null,
  unlocks: readonly RatingMode[] | null | undefined,
): CheckingItem[] {
  const running = CHECKS_IN_MODE[mode];
  const total = cleanSecondsNeeded(mode);
  return ALL_CHECKS.map((id): CheckingItem => {
    if (id === 'pots' || !running.includes(id)) return { id, state: 'off' };
    if (unlocks && !unlocks.includes(REQUIRED_UNLOCK[id])) return { id, state: 'unavailable' };
    const needed = CLEAN_SECONDS_NEEDED[id];
    const reachable = needed <= total;
    return { id, state: reachable && cleanSeconds !== null && cleanSeconds >= needed ? 'ready' : 'checking' };
  });
}
