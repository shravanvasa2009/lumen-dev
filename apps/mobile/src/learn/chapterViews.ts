import type { ComponentType } from 'react';

import { AfibChapter } from './AfibChapter';
import { DoctorChapter, HrvChapter, LimitsChapter } from './ChapterBody';
import { DiabetesChapter } from './DiabetesChapter';
import type { Lesson } from './lessons';
import { PulseChapter } from './PulseChapter';
import { RhythmChapter } from './RhythmChapter';
import { StrokeChapter } from './StrokeChapter';

// Every chapter's illustrated view, by slug; /learn/[slug] draws the one that matches.
export const chapterViews: Readonly<Record<string, ComponentType<{ lesson: Lesson }>>> = {
  'how-lumen-reads-your-pulse': PulseChapter,
  'how-the-rhythm-check-works': RhythmChapter,
  'what-is-afib': AfibChapter,
  'stroke-warning-signs': StrokeChapter,
  'diabetes-and-your-pulse': DiabetesChapter,
  'heart-rate-variability': HrvChapter,
  'what-lumen-cannot-measure': LimitsChapter,
  'when-to-see-a-doctor': DoctorChapter,
};
