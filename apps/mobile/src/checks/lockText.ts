import type { TFunction } from 'i18next';

import type { LockWhy } from './checkPlan';

export function lockText(t: TFunction, why: LockWhy): string {
  const texts: Record<LockWhy, string> = {
    fps60: t('mode.locked60fps'),
    flash: t('mode.lockedFlash'),
    full: t('mode.lockedFull'),
    basic: t('mode.lockedBasic'),
    unsupported: t('mode.lockedUnsupported'),
  };
  return texts[why];
}
