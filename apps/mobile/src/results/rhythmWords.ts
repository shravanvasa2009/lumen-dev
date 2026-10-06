import type { RhythmClass, RhythmMetric } from '@lumen/core';
import type { TFunction } from 'i18next';

// Shared by the Results card, the Show me why card, Trends and the Doctor report so all name the same
// class the same way. No class: the reading was too short to judge (ADR 0104 answer 5).
export function rhythmClassWords(
  t: TFunction,
  rhythmClass: RhythmClass | null,
): { value: string; note: string } {
  if (rhythmClass === null) return { value: t('results.rhythmTooShort'), note: t('results.noteTooShort') };
  if (rhythmClass === 'sinus') return { value: t('results.rhythmRegular'), note: t('results.noteRegular') };
  if (rhythmClass === 'af') return { value: t('results.rhythmIrregular'), note: t('results.noteIrregular') };
  return { value: t('results.rhythmOther'), note: t('results.noteOther') };
}

export function rhythmWords(t: TFunction, rhythm: RhythmMetric): { value: string; note: string } {
  return rhythmClassWords(t, rhythm.class);
}
