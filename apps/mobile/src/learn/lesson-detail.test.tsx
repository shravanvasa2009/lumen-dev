import i18next from 'i18next';
import { renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';

import { lessons } from './lessons';

import '@/i18n';

const appDirectory = './app';

describe('lesson detail', () => {
  it('renders every lesson under its own title', () => {
    for (const lesson of lessons) {
      const { unmount } = renderRouter(appDirectory, { initialUrl: `/learn/${lesson.slug}` });
      expect(screen.getByRole('header', { name: lesson.title(i18next.t) })).toBeOnTheScreen();
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
    expect(screen.getByRole('header', { name: en['learn.notFound'] })).toBeOnTheScreen();
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
    expect(screen.queryByText(new RegExp('In testing, about'))).toBeNull();
  });
});
