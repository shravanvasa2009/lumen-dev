import type { RhythmMetric } from '@lumen/core';
import type { TFunction } from 'i18next';

// The question the Why pages ask and the plain-words answer, by the rhythm class the reading got. No class
// means the reading was too short to judge (ADR 0104 answer 5).
export function whyCopy(t: TFunction, rhythm: RhythmMetric): { title: string; explain: string } {
  if (rhythm.class === null) return { title: t('results.rhythmTooShort'), explain: t('why.explainTooShort') };
  if (rhythm.class === 'af') return { title: t('why.titleIrregular'), explain: t('why.explainIrregular') };
  if (rhythm.class === 'sinus') return { title: t('why.titleRegular'), explain: t('why.explainRegular') };
  return { title: t('why.titleOther'), explain: t('why.explainOther') };
}
