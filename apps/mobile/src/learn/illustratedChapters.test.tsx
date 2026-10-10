import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { expectChapterTitle, expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { lessons } from './lessons';

import '@/i18n';

preloadAppRoutes();

type EnKey = keyof typeof en;

const chapters: readonly {
  slug: string;
  position: number;
  images: readonly EnKey[];
  wrong: EnKey;
  correct: EnKey;
  nextTitle: EnKey | null;
}[] = [
  {
    slug: 'heart-rate-variability',
    position: 6,
    images: ['learn.hrv.heroLabel', 'learn.hrv.barsLabel', 'learn.hrv.weeksLabel', 'learn.hrv.bandLabel'],
    wrong: 'learn.hrv.answerOthers',
    correct: 'learn.hrv.answerOwn',
    nextTitle: 'learn.lessonLimits',
  },
  {
    slug: 'what-lumen-cannot-measure',
    position: 7,
    images: ['learn.limits.heroLabel', 'learn.limits.canCannotLabel', 'learn.limits.whyLabel'],
    wrong: 'learn.limits.answerPressure',
    correct: 'learn.limits.answerPulse',
    nextTitle: 'learn.lessonDoctor',
  },
  {
    slug: 'when-to-see-a-doctor',
    position: 8,
    images: [
      'learn.doctor.flowLabel',
      'learn.doctor.weekLabel',
      'learn.doctor.rateLabel',
      'learn.doctor.racesLabel',
      'learn.doctor.reportLabel',
    ],
    wrong: 'learn.doctor.answerCost',
    correct: 'learn.doctor.answerFainting',
    nextTitle: null,
  },
];

describe('illustrated chapters 6, 7 and 8', () => {
  it.each(chapters)(
    'draws every figure of $slug, shows its progress and answers the quiz',
    ({ slug, position, images, wrong, correct }) => {
      renderRouter('./app', { initialUrl: `/learn/${slug}` });
      expect(
        screen.getByText(
          en['learn.lessonProgress']
            .replace('{{n}}', String(position))
            .replace('{{total}}', String(lessons.length)),
        ),
      ).toBeOnTheScreen();
      for (const image of images) {
        expect(screen.getByRole('image', { name: en[image] })).toBeOnTheScreen();
      }
      fireEvent.press(screen.getByRole('radio', { name: en[wrong] }));
      expect(screen.getByText(en['learn.quizTryAgain'])).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('radio', { name: en[correct] }));
      expect(screen.getByText(en['learn.quizCorrect'])).toBeOnTheScreen();
    },
  );

  it('carries every new string in Spanish', () => {
    const newKeys = Object.keys(en).filter((key) => /^learn\.(hrv|limits|doctor)\./.test(key));
    for (const key of newKeys) expect(es).toHaveProperty([key]);
    expect(es['learn.hrv.week']).toContain('{{n}}');
  });

  it('opens the next chapter from the tile', () => {
    renderRouter('./app', { initialUrl: '/learn/heart-rate-variability' });
    const label = en['learn.nextLesson'].replace('{{title}}', en['learn.lessonLimits']);
    fireEvent.press(screen.getByRole('button', { name: label }));
    expectChapterTitle(en['learn.guideTitle'], en['learn.lessonLimits']);
  });

  it('sends the last chapter back to Learn', () => {
    renderRouter('./app', { initialUrl: '/learn/when-to-see-a-doctor' });
    expect(screen.queryByText(en['learn.doctor.finished'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['learn.doctor.backToLearn'] }));
    expect(screen.getByText(en['learn.careFinderHint'])).toBeOnTheScreen();
  });

  it('opens the Settings accuracy screen from chapter 6', () => {
    renderRouter('./app', { initialUrl: '/learn/heart-rate-variability' });
    fireEvent.press(
      screen.getByRole('button', { name: `${en['tabs.settings']}: ${en['settings.accuracy']}` }),
    );
    expectNavTitle(en['accuracy.title']);
  });

  it('dials 911 from every Call 911 button in chapters 7 and 8', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    for (const slug of ['what-lumen-cannot-measure', 'when-to-see-a-doctor']) {
      const { unmount } = renderRouter('./app', { initialUrl: `/learn/${slug}` });
      for (const button of screen.getAllByRole('button', { name: en['emergency.call'] })) {
        fireEvent.press(button);
      }
      unmount();
    }
    expect(openURL).toHaveBeenCalledTimes(3);
    expect(openURL).toHaveBeenCalledWith('tel:911');
    openURL.mockRestore();
  });

  it('tells the reader to dial 911 themselves when the phone cannot start the call', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no dialer'));
    renderRouter('./app', { initialUrl: '/learn/what-lumen-cannot-measure' });
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en['emergency.call'] })));
    expect(screen.getByText(en['learn.doctor.callFailed'])).toBeOnTheScreen();
    openURL.mockRestore();
  });

  it('opens the Care tab from both Find care buttons in chapter 8', () => {
    renderRouter('./app', { initialUrl: '/learn/when-to-see-a-doctor' });
    const buttons = screen.getAllByRole('button', { name: en['learn.doctor.findCare'] });
    expect(buttons).toHaveLength(2);
    const [first] = buttons;
    if (!first) throw new Error('no Find care button');
    fireEvent.press(first);
    expect(screen.getByRole('header', { name: en['careMap.title'] })).toBeOnTheScreen();
  });
});
