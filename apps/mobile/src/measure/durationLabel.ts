import type { TFunction } from 'i18next';

import type { ModeDuration } from './mode';

export function durationLabel(t: TFunction, { amount, unit, approximate }: ModeDuration): string {
  if (unit === 'seconds') return t('mode.seconds', { count: amount });
  return approximate ? t('mode.approxMinutes', { count: amount }) : t('mode.minutes', { count: amount });
}
