import type { TFunction } from 'i18next';

type LessonTone = 'accent' | 'flag' | 'public';

export type Lesson = {
  // The slug is the route segment of /learn/[slug].
  slug: string;
  tone: LessonTone;
  title: (t: TFunction) => string;
  // Shown under the title in the list, for example "2 min".
  length: (t: TFunction) => string;
  body: (t: TFunction) => readonly string[];
  // Spec 8.4 gives only the first lesson an animation; it is a labelled placeholder until artwork exists.
  illustration?: (t: TFunction) => string;
  // The heart-rhythm lesson appends the measured false-alarm figures from evidence.json.
  showsRhythmFigures?: boolean;
};

// Each key stays a literal so the i18n check can see it.
export const lessons: readonly Lesson[] = [
  {
    slug: 'how-lumen-reads-your-pulse',
    tone: 'accent',
    title: (t) => t('learn.lessonPulse'),
    length: (t) => t('learn.minutesAnimated', { minutes: 2 }),
    illustration: (t) => t('learn.pulseAnimation'),
    body: (t) => [t('learn.pulse.p1'), t('learn.pulse.p2'), t('learn.pulse.p3')],
  },
  {
    slug: 'what-is-afib',
    tone: 'flag',
    title: (t) => t('learn.lessonAfib'),
    length: (t) => t('learn.minutes', { minutes: 3 }),
    body: (t) => [t('learn.afib.p1'), t('learn.afib.p2'), t('learn.afib.p3'), t('learn.afib.p4')],
  },
  {
    slug: 'how-the-rhythm-check-works',
    tone: 'public',
    title: (t) => t('learn.lessonRhythm'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    showsRhythmFigures: true,
    body: (t) => [t('learn.rhythm.p1'), t('learn.rhythm.p2'), t('learn.rhythm.p3')],
  },
  {
    slug: 'stroke-warning-signs',
    tone: 'flag',
    title: (t) => t('learn.lessonStroke'),
    length: (t) => t('learn.minutes', { minutes: 1 }),
    body: (t) => [
      t('learn.stroke.intro'),
      t('learn.stroke.balance'),
      t('learn.stroke.eyes'),
      t('learn.stroke.face'),
      t('learn.stroke.arm'),
      t('learn.stroke.speech'),
      t('learn.stroke.time'),
    ],
  },
  {
    slug: 'diabetes-and-your-pulse',
    tone: 'flag',
    title: (t) => t('learn.lessonDiabetes'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    body: (t) => [t('learn.diabetes.p1'), t('learn.diabetes.p2'), t('learn.diabetes.p3')],
  },
  {
    slug: 'heart-rate-variability',
    tone: 'public',
    title: (t) => t('learn.lessonHrv'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    body: (t) => [t('learn.hrv.p1'), t('learn.hrv.p2'), t('learn.hrv.p3'), t('learn.hrv.p4')],
  },
  {
    slug: 'what-lumen-cannot-measure',
    tone: 'public',
    title: (t) => t('learn.lessonLimits'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    body: (t) => [t('learn.limits.p1'), t('learn.limits.p2'), t('learn.limits.p3'), t('learn.limits.p4')],
  },
  {
    slug: 'when-to-see-a-doctor',
    tone: 'accent',
    title: (t) => t('learn.lessonDoctor'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    body: (t) => [
      t('learn.doctor.p1'),
      t('learn.doctor.p2'),
      t('learn.doctor.p3'),
      t('learn.doctor.p4'),
      t('learn.doctor.p5'),
    ],
  },
];
