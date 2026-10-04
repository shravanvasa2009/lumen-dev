import i18next from 'i18next';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { lessons } from './lessons';

import '@/i18n';

const appDirectory = './app';

preloadAppRoutes();

type EnKey = keyof typeof en;

const convertedLessons: readonly {
  slug: string;
  headings: readonly EnKey[];
  paragraphs: readonly EnKey[];
  takeaway: EnKey;
  wrong: EnKey;
  correct: EnKey;
}[] = [
  {
    slug: 'what-is-afib',
    headings: ['learn.afib.h1', 'learn.afib.h2', 'learn.afib.h3', 'learn.afib.h4'],
    paragraphs: ['learn.afib.p1', 'learn.afib.p2', 'learn.afib.p3', 'learn.afib.p4'],
    takeaway: 'learn.afib.takeaway',
    wrong: 'learn.afib.answerDiagnosis',
    correct: 'learn.afib.answerRetake',
  },
  {
    slug: 'stroke-warning-signs',
    headings: [
      'learn.stroke.h1',
      'learn.stroke.h2',
      'learn.stroke.h3',
      'learn.stroke.h4',
      'learn.stroke.h5',
      'learn.stroke.h6',
      'learn.stroke.h7',
    ],
    paragraphs: [
      'learn.stroke.intro',
      'learn.stroke.balance',
      'learn.stroke.eyes',
      'learn.stroke.face',
      'learn.stroke.arm',
      'learn.stroke.speech',
      'learn.stroke.time',
    ],
    takeaway: 'learn.stroke.takeaway',
    wrong: 'learn.stroke.answerTremor',
    correct: 'learn.stroke.answerTime',
  },
  {
    slug: 'diabetes-and-your-pulse',
    headings: ['learn.diabetes.h1', 'learn.diabetes.h2', 'learn.diabetes.h3'],
    paragraphs: ['learn.diabetes.p1', 'learn.diabetes.p2', 'learn.diabetes.p3'],
    takeaway: 'learn.diabetes.takeaway',
    wrong: 'learn.diabetes.answerDiagnosis',
    correct: 'learn.diabetes.answerA1c',
  },
  {
    slug: 'heart-rate-variability',
    headings: ['learn.hrv.h1', 'learn.hrv.h2', 'learn.hrv.h3', 'learn.hrv.h4'],
    paragraphs: ['learn.hrv.p1', 'learn.hrv.p2', 'learn.hrv.p3', 'learn.hrv.p4'],
    takeaway: 'learn.hrv.takeaway',
    wrong: 'learn.hrv.answerOthers',
    correct: 'learn.hrv.answerOwn',
  },
  {
    slug: 'what-lumen-cannot-measure',
    headings: ['learn.limits.h1', 'learn.limits.h2', 'learn.limits.h3', 'learn.limits.h4'],
    paragraphs: ['learn.limits.p1', 'learn.limits.p2', 'learn.limits.p3', 'learn.limits.p4'],
    takeaway: 'learn.limits.takeaway',
    wrong: 'learn.limits.answerPressure',
    correct: 'learn.limits.answerPulse',
  },
  {
    slug: 'when-to-see-a-doctor',
    headings: ['learn.doctor.h1', 'learn.doctor.h2', 'learn.doctor.h3', 'learn.doctor.h4', 'learn.doctor.h5'],
    paragraphs: [
      'learn.doctor.p1',
      'learn.doctor.p2',
      'learn.doctor.p3',
      'learn.doctor.p4',
      'learn.doctor.p5',
    ],
    takeaway: 'learn.doctor.takeaway',
    wrong: 'learn.doctor.answerCost',
    correct: 'learn.doctor.answerFainting',
  },
];

describe('lesson detail', () => {
  it('renders every lesson under its own title', () => {
    for (const lesson of lessons) {
      const { unmount } = renderRouter(appDirectory, { initialUrl: `/learn/${lesson.slug}` });
      expectNavTitle(lesson.title(i18next.t));
      unmount();
    }
  });

  it('shows the animation placeholder only on the first lesson', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-lumen-reads-your-pulse' });
    expect(screen.getByText(en['learn.pulseAnimation'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.pulse.p1'])).toBeOnTheScreen();
  });

  it('says the lesson was not found for an unknown slug instead of crashing', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/no-such-lesson' });
    expectNavTitle(en['learn.notFound']);
  });

  it('keeps the diabetes lesson to "not a diabetes test" and an A1c blood test', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/diabetes-and-your-pulse' });
    expect(screen.getByText(en['learn.diabetes.p3'])).toBeOnTheScreen();
    expect(screen.getByText(new RegExp('not a diabetes test', 'i'))).toBeOnTheScreen();
  });

  it('shows "Not yet tested" for both rhythm figures while evidence.json has neither', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-the-rhythm-check-works' });
    expect(screen.getByText(en['learn.rhythmExtraBeatsNote'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.rhythmAbstainLabel'])).toBeOnTheScreen();
    expect(screen.getAllByText(en['evidence.notTested'])).toHaveLength(2);
    expect(screen.queryByText(new RegExp('In development testing on recordings'))).toBeNull();
    expect(screen.queryByText(new RegExp('^Source:'))).toBeNull();
  });

  it('lays the pulse lesson out as numbered cards with a takeaway', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-lumen-reads-your-pulse' });
    expect(screen.getByText(progressText(1))).toBeOnTheScreen();
    for (const key of ['learn.pulse.h1', 'learn.pulse.h2', 'learn.pulse.h3'] as const) {
      expect(screen.getByRole('header', { name: en[key] })).toBeOnTheScreen();
    }
    for (const key of ['learn.pulse.p1', 'learn.pulse.p2', 'learn.pulse.p3'] as const) {
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    }
    expect(screen.getByText(en['learn.pulse.blurLabel'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.pulse.chipCold'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.takeawayLabel'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.pulse.takeaway'])).toBeOnTheScreen();
  });

  it('answers the quick check with feedback and lets the reader try again', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-lumen-reads-your-pulse' });
    expect(screen.getByText(en['learn.quickCheck'])).toBeOnTheScreen();
    expect(screen.queryByText(en['learn.quizCorrect'])).toBeNull();
    fireEvent.press(screen.getByRole('radio', { name: en['learn.pulse.answerGuess'] }));
    expect(screen.getByText(en['learn.quizTryAgain'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('radio', { name: en['learn.pulse.answerRetake'] }));
    expect(screen.getByText(en['learn.quizCorrect'])).toBeOnTheScreen();
    expect(screen.queryByText(en['learn.quizTryAgain'])).toBeNull();
  });

  it('opens the next lesson from the button', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-lumen-reads-your-pulse' });
    const label = en['learn.nextLesson'].replace('{{title}}', en['learn.lessonAfib']);
    fireEvent.press(screen.getByRole('button', { name: label }));
    expectNavTitle(en['learn.lessonAfib']);
    expect(screen.getByText(en['learn.afib.p1'])).toBeOnTheScreen();
  });

  it('gives the rhythm lesson its cards, Experimental badge and takeaway around the unchanged figures', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-the-rhythm-check-works' });
    expect(screen.getByText(progressText(3))).toBeOnTheScreen();
    for (const key of ['learn.rhythm.p1', 'learn.rhythm.p2', 'learn.rhythm.p3'] as const) {
      expect(screen.getByText(en[key])).toBeOnTheScreen();
    }
    expect(screen.getByText(en['learn.rhythm.chipExtra'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.rhythmTestingHeading'])).toBeOnTheScreen();
    expect(screen.getByText(en['evidence.experimental'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.rhythm.takeaway'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('radio', { name: en['learn.rhythm.answerDoctor'] }));
    expect(screen.getByText(en['learn.quizCorrect'])).toBeOnTheScreen();
  });

  it('exposes every diagram as one labelled image', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-lumen-reads-your-pulse' });
    expect(screen.getAllByRole('image')).toHaveLength(2);
    const steps = [en['learn.pulse.step1'], en['learn.pulse.step2'], en['learn.pulse.step3']];
    expect(screen.getByRole('image', { name: steps.join('. ') })).toBeOnTheScreen();
    const wave = [
      en['learn.pulse.beatMark'],
      en['learn.pulse.gapMark'],
      en['learn.pulse.darker'],
      en['learn.pulse.lighter'],
    ];
    expect(screen.getByRole('image', { name: wave.join('. ') })).toBeOnTheScreen();
  });

  it('labels the rhythm diagram with both row names', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-the-rhythm-check-works' });
    const label = `${en['learn.rhythm.steady']}. ${en['learn.rhythm.irregular']}`;
    expect(screen.getByRole('image', { name: label })).toBeOnTheScreen();
  });

  it('marks only the picked quick-check answer as checked', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-lumen-reads-your-pulse' });
    const guess = () => screen.getByRole('radio', { name: en['learn.pulse.answerGuess'] });
    const retake = () => screen.getByRole('radio', { name: en['learn.pulse.answerRetake'] });
    expect(guess().props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(guess());
    expect(guess().props.accessibilityState).toMatchObject({ checked: true });
    expect(retake().props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(retake());
    expect(guess().props.accessibilityState).toMatchObject({ checked: false });
    expect(retake().props.accessibilityState).toMatchObject({ checked: true });
  });

  it.each(convertedLessons)(
    'gives $slug numbered cards with verbatim paragraphs, a takeaway and a quick check',
    ({ slug, headings, paragraphs, takeaway, correct, wrong }) => {
      renderRouter(appDirectory, { initialUrl: `/learn/${slug}` });
      for (const heading of headings) {
        expect(screen.getByRole('header', { name: en[heading] })).toBeOnTheScreen();
      }
      for (const paragraph of paragraphs) {
        expect(screen.getByText(en[paragraph])).toBeOnTheScreen();
      }
      expect(screen.getByText(en['learn.takeawayLabel'])).toBeOnTheScreen();
      expect(screen.getByText(en[takeaway])).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('radio', { name: en[wrong] }));
      expect(screen.getByText(en['learn.quizTryAgain'])).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('radio', { name: en[correct] }));
      expect(screen.getByText(en['learn.quizCorrect'])).toBeOnTheScreen();
    },
  );

  it('lists the stroke signs in BE FAST order, then the 911 line, then a takeaway that says call 911', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/stroke-warning-signs' });
    const signs = ['balance', 'eyes', 'face', 'arm', 'speech', 'time'] as const;
    const shown = screen.getAllByText(new RegExp('^[BEFAST], ')).map((node) => node.props.children);
    expect(shown).toEqual(signs.map((sign) => en[`learn.stroke.${sign}`]));
    expect(en['learn.stroke.takeaway']).toContain('call 911 right away');
    expect(screen.getByText(en['learn.stroke.takeaway'])).toBeOnTheScreen();
  });

  it('offers no stroke quiz answer that suggests waiting', () => {
    for (const key of ['answerTime', 'answerTemperature', 'answerTremor'] as const) {
      expect(en[`learn.stroke.${key}`]).not.toMatch(new RegExp('wait|later|rest|see if|monitor', 'i'));
    }
  });

  it('names the diabetes pattern as a pattern linked to diabetes, never a diagnosis', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/diabetes-and-your-pulse' });
    expect(screen.getByRole('header', { name: en['learn.diabetes.h2'] })).toBeOnTheScreen();
    expect(screen.getByText(en['learn.diabetes.takeaway'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.diabetes.question'])).toBeOnTheScreen();
    expect(en['learn.diabetes.question']).toContain('screening prototype');
  });
});

function progressText(position: number) {
  return en['learn.lessonProgress']
    .replace('{{n}}', String(position))
    .replace('{{total}}', String(lessons.length));
}
