import type { RhythmMetric } from '@lumen/core';
import type { TFunction } from 'i18next';

// Shared by the Results card and the Show me why card so both name the same class the same way.
export function rhythmWords(t: TFunction, rhythm: RhythmMetric): { value: string; note: string } {
  if (rhythm.class === 'sinus') return { value: t('results.rhythmRegular'), note: t('results.noteRegular') };
  if (rhythm.class === 'af') return { value: t('results.rhythmIrregular'), note: t('results.noteIrregular') };
  return { value: t('results.rhythmOther'), note: t('results.noteOther') };
}
