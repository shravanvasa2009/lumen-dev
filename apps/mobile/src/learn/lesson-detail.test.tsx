import i18next from 'i18next';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { lessons } from './lessons';

import '@/i18n';

const appDirectory = './app';

preloadAppRoutes();

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
    const wave = [en['learn.pulse.beatMark'], en['learn.pulse.gapMark']];
    expect(screen.getByRole('image', { name: new RegExp(wave.join('\. ')) })).toBeOnTheScreen();
  });

  it('labels the rhythm diagram with both row names', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/how-the-rhythm-check-works' });
    const label = `${en['learn.rhythm.steady']}. ${en['learn.rhythm.irregular']}`;
    expect(screen.getByRole('image', { name: label })).toBeOnTheScreen();
  });

  it('keeps the other lessons on plain paragraphs without template parts', () => {
    renderRouter(appDirectory, { initialUrl: '/learn/what-is-afib' });
    expect(screen.getByText(en['learn.afib.p1'])).toBeOnTheScreen();
    expect(screen.queryByText(en['learn.quickCheck'])).toBeNull();
    expect(screen.queryByText(en['learn.takeawayLabel'])).toBeNull();
  });
});

function progressText(position: number) {
  return en['learn.lessonProgress']
    .replace('{{n}}', String(position))
    .replace('{{total}}', String(lessons.length));
}
