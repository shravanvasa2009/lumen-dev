import type { TFunction } from 'i18next';

type LessonTone = 'accent' | 'flag' | 'public';

export type LessonDiagramId = 'finger-on-lens' | 'pulse-wave' | 'rhythm-gaps';

export type LessonSection = {
  heading: (t: TFunction) => string;
  body: (t: TFunction) => string;
  diagram?: LessonDiagramId;
  // Short causes shown as chips under the body, with a small label above them when one is given.
  chips?: { label?: (t: TFunction) => string; items: (t: TFunction) => readonly string[] };
};

export type LessonQuestion = {
  prompt: (t: TFunction) => string;
  options: (t: TFunction) => readonly string[];
  correctIndex: number;
};

// A lesson written as numbered cards, a takeaway and one optional question instead of plain paragraphs.
export type LessonTemplate = {
  // Drawn above the first card.
  heroDiagram?: LessonDiagramId;
  sections: readonly LessonSection[];
  takeaway: (t: TFunction) => string;
  question: LessonQuestion;
};

type LessonContent = { body: (t: TFunction) => readonly string[] } | { template: LessonTemplate };

export type Lesson = LessonContent & {
  // The slug is the route segment of /learn/[slug].
  slug: string;
  tone: LessonTone;
  title: (t: TFunction) => string;
  // Shown under the title in the list, for example "2 min".
  length: (t: TFunction) => string;
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
    template: {
      heroDiagram: 'finger-on-lens',
      sections: [
        { heading: (t) => t('learn.pulse.h1'), body: (t) => t('learn.pulse.p1') },
        { heading: (t) => t('learn.pulse.h2'), body: (t) => t('learn.pulse.p2'), diagram: 'pulse-wave' },
        {
          heading: (t) => t('learn.pulse.h3'),
          body: (t) => t('learn.pulse.p3'),
          chips: {
            label: (t) => t('learn.pulse.blurLabel'),
            items: (t) => [
              t('learn.pulse.chipMoving'),
              t('learn.pulse.chipPressing'),
              t('learn.pulse.chipCold'),
            ],
          },
        },
      ],
      takeaway: (t) => t('learn.pulse.takeaway'),
      question: {
        prompt: (t) => t('learn.pulse.question'),
        options: (t) => [
          t('learn.pulse.answerGuess'),
          t('learn.pulse.answerRetake'),
          t('learn.pulse.answerDiagnosis'),
        ],
        correctIndex: 1,
      },
    },
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
    template: {
      sections: [
        {
          heading: (t) => t('learn.rhythm.h1'),
          body: (t) => t('learn.rhythm.p1'),
          diagram: 'rhythm-gaps',
        },
        {
          heading: (t) => t('learn.rhythm.h2'),
          body: (t) => t('learn.rhythm.p2'),
          chips: {
            items: (t) => [
              t('learn.rhythm.chipMovement'),
              t('learn.rhythm.chipLoose'),
              t('learn.rhythm.chipExtra'),
            ],
          },
        },
        { heading: (t) => t('learn.rhythm.h3'), body: (t) => t('learn.rhythm.p3') },
      ],
      takeaway: (t) => t('learn.rhythm.takeaway'),
      question: {
        prompt: (t) => t('learn.rhythm.question'),
        options: (t) => [
          t('learn.rhythm.answerIgnore'),
          t('learn.rhythm.answerDoctor'),
          t('learn.rhythm.answerDiagnosis'),
        ],
        correctIndex: 1,
      },
    },
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
