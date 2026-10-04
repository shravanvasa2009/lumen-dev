import type { RatingMode } from '@lumen/core';

import type { LockWhy } from '@/checks/checkPlan';
import type { MODES } from '@/measure/mode';
import type { StoredRating } from '@/store/deviceRating';

type ListedMode = keyof typeof MODES;

// Spec §5.2 and §12 (Modes): the rating row each listed mode needs.
const REQUIRED_MODE: Record<ListedMode, RatingMode> = {
  quick: 'quickCheck',
  full: 'fullScan',
  deep: 'deepHrv',
  standing: 'standingTest',
};

const DEEP_HRV_MIN_FPS = 60;

// Why the phone's rating keeps a mode locked, or null when the mode is open. A phone with no rating yet
// keeps every mode open: the rating gates features, and before it exists nothing has been measured to gate on.
export function lockReason(rating: StoredRating | null | undefined, mode: ListedMode): LockWhy | null {
  if (rating === null || rating === undefined) return null;
  if (rating.unlocks.includes(REQUIRED_MODE[mode])) return null;
  if (rating.tier === 'unsupported') return 'unsupported';
  if (rating.ambient) return 'flash';
  if (mode !== 'deep') return 'basic';
  // Deep HRV needs 60 fps (DSP-12) and a Full rating; the frame rate is the reason only when it is the cause.
  return rating.fpsLevel === null || rating.fpsLevel < DEEP_HRV_MIN_FPS ? 'fps60' : 'full';
}
