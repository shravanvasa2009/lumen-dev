import type { TFunction } from 'i18next';

// The slug is the route segment of /learn/[slug]; the title is a lookup so each key stays a literal.
export const lessons: readonly { slug: string; title: (t: TFunction) => string }[] = [
  { slug: 'how-lumen-reads-your-pulse', title: (t) => t('learn.lessonPulse') },
  { slug: 'what-is-afib', title: (t) => t('learn.lessonAfib') },
  { slug: 'stroke-warning-signs', title: (t) => t('learn.lessonStroke') },
  { slug: 'diabetes-and-your-pulse', title: (t) => t('learn.lessonDiabetes') },
  { slug: 'heart-rate-variability', title: (t) => t('learn.lessonHrv') },
  { slug: 'what-lumen-cannot-measure', title: (t) => t('learn.lessonLimits') },
  { slug: 'when-to-see-a-doctor', title: (t) => t('learn.lessonDoctor') },
];
