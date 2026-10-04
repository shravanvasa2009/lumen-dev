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

export type Lesson = {
  template: LessonTemplate;
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
    template: {
      sections: [
        { heading: (t) => t('learn.afib.h1'), body: (t) => t('learn.afib.p1'), diagram: 'rhythm-gaps' },
        { heading: (t) => t('learn.afib.h2'), body: (t) => t('learn.afib.p2') },
        { heading: (t) => t('learn.afib.h3'), body: (t) => t('learn.afib.p3') },
        { heading: (t) => t('learn.afib.h4'), body: (t) => t('learn.afib.p4') },
      ],
      takeaway: (t) => t('learn.afib.takeaway'),
      question: {
        prompt: (t) => t('learn.afib.question'),
        options: (t) => [
          t('learn.afib.answerDiagnosis'),
          t('learn.afib.answerRetake'),
          t('learn.afib.answerIgnore'),
        ],
        correctIndex: 1,
      },
    },
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
    template: {
      sections: [
        { heading: (t) => t('learn.stroke.h1'), body: (t) => t('learn.stroke.intro') },
        { heading: (t) => t('learn.stroke.h2'), body: (t) => t('learn.stroke.balance') },
        { heading: (t) => t('learn.stroke.h3'), body: (t) => t('learn.stroke.eyes') },
        { heading: (t) => t('learn.stroke.h4'), body: (t) => t('learn.stroke.face') },
        { heading: (t) => t('learn.stroke.h5'), body: (t) => t('learn.stroke.arm') },
        { heading: (t) => t('learn.stroke.h6'), body: (t) => t('learn.stroke.speech') },
        { heading: (t) => t('learn.stroke.h7'), body: (t) => t('learn.stroke.time') },
      ],
      takeaway: (t) => t('learn.stroke.takeaway'),
      question: {
        prompt: (t) => t('learn.stroke.question'),
        options: (t) => [
          t('learn.stroke.answerTemperature'),
          t('learn.stroke.answerTime'),
          t('learn.stroke.answerTremor'),
        ],
        correctIndex: 1,
      },
    },
  },
  {
    slug: 'diabetes-and-your-pulse',
    tone: 'flag',
    title: (t) => t('learn.lessonDiabetes'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    template: {
      sections: [
        { heading: (t) => t('learn.diabetes.h1'), body: (t) => t('learn.diabetes.p1') },
        {
          heading: (t) => t('learn.diabetes.h2'),
          body: (t) => t('learn.diabetes.p2'),
          chips: {
            label: (t) => t('learn.diabetes.alsoLabel'),
            items: (t) => [
              t('learn.diabetes.chipAge'),
              t('learn.diabetes.chipCold'),
              t('learn.diabetes.chipMedicines'),
            ],
          },
        },
        { heading: (t) => t('learn.diabetes.h3'), body: (t) => t('learn.diabetes.p3') },
      ],
      takeaway: (t) => t('learn.diabetes.takeaway'),
      question: {
        prompt: (t) => t('learn.diabetes.question'),
        options: (t) => [
          t('learn.diabetes.answerDiagnosis'),
          t('learn.diabetes.answerA1c'),
          t('learn.diabetes.answerIgnore'),
        ],
        correctIndex: 1,
      },
    },
  },
  {
    slug: 'heart-rate-variability',
    tone: 'public',
    title: (t) => t('learn.lessonHrv'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    template: {
      sections: [
        { heading: (t) => t('learn.hrv.h1'), body: (t) => t('learn.hrv.p1') },
        {
          heading: (t) => t('learn.hrv.h2'),
          body: (t) => t('learn.hrv.p2'),
          chips: {
            label: (t) => t('learn.hrv.recoveryLabel'),
            items: (t) => [t('learn.hrv.chipStress'), t('learn.hrv.chipExercise'), t('learn.hrv.chipSleep')],
          },
        },
        { heading: (t) => t('learn.hrv.h3'), body: (t) => t('learn.hrv.p3') },
        { heading: (t) => t('learn.hrv.h4'), body: (t) => t('learn.hrv.p4') },
      ],
      takeaway: (t) => t('learn.hrv.takeaway'),
      question: {
        prompt: (t) => t('learn.hrv.question'),
        options: (t) => [t('learn.hrv.answerOthers'), t('learn.hrv.answerOwn'), t('learn.hrv.answerTimes')],
        correctIndex: 1,
      },
    },
  },
  {
    slug: 'what-lumen-cannot-measure',
    tone: 'public',
    title: (t) => t('learn.lessonLimits'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    template: {
      sections: [
        { heading: (t) => t('learn.limits.h1'), body: (t) => t('learn.limits.p1') },
        {
          heading: (t) => t('learn.limits.h2'),
          body: (t) => t('learn.limits.p2'),
          chips: {
            items: (t) => [
              t('learn.limits.chipPressure'),
              t('learn.limits.chipOxygen'),
              t('learn.limits.chipArteries'),
              t('learn.limits.chipHeartAttack'),
            ],
          },
        },
        { heading: (t) => t('learn.limits.h3'), body: (t) => t('learn.limits.p3') },
        { heading: (t) => t('learn.limits.h4'), body: (t) => t('learn.limits.p4') },
      ],
      takeaway: (t) => t('learn.limits.takeaway'),
      question: {
        prompt: (t) => t('learn.limits.question'),
        options: (t) => [
          t('learn.limits.answerPressure'),
          t('learn.limits.answerOxygen'),
          t('learn.limits.answerPulse'),
        ],
        correctIndex: 2,
      },
    },
  },
  {
    slug: 'when-to-see-a-doctor',
    tone: 'accent',
    title: (t) => t('learn.lessonDoctor'),
    length: (t) => t('learn.minutes', { minutes: 2 }),
    template: {
      sections: [
        { heading: (t) => t('learn.doctor.h1'), body: (t) => t('learn.doctor.p1') },
        {
          heading: (t) => t('learn.doctor.h2'),
          body: (t) => t('learn.doctor.p2'),
          chips: {
            items: (t) => [
              t('learn.doctor.chipChest'),
              t('learn.doctor.chipFainting'),
              t('learn.doctor.chipBreath'),
              t('learn.doctor.chipStroke'),
            ],
          },
        },
        {
          heading: (t) => t('learn.doctor.h3'),
          body: (t) => t('learn.doctor.p3'),
          chips: {
            items: (t) => [
              t('learn.doctor.chipRepeat'),
              t('learn.doctor.chipRate'),
              t('learn.doctor.chipRacing'),
            ],
          },
        },
        { heading: (t) => t('learn.doctor.h4'), body: (t) => t('learn.doctor.p4') },
        { heading: (t) => t('learn.doctor.h5'), body: (t) => t('learn.doctor.p5') },
      ],
      takeaway: (t) => t('learn.doctor.takeaway'),
      question: {
        prompt: (t) => t('learn.doctor.question'),
        options: (t) => [
          t('learn.doctor.answerRepeat'),
          t('learn.doctor.answerFainting'),
          t('learn.doctor.answerCost'),
        ],
        correctIndex: 1,
      },
    },
  },
];
