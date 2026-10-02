import type { CoachingKey } from '@lumen/core';
import type { TFunction } from 'i18next';

// Each key is a literal t() call so the i18n check can see it is used.
export function coachingText(t: TFunction): Record<CoachingKey, string> {
  return {
    'coach.cover': t('coach.cover'),
    'coach.lighter': t('coach.lighter'),
    'coach.still': t('coach.still'),
    'coach.warm': t('coach.warm'),
    'coach.flat': t('coach.flat'),
  };
}
