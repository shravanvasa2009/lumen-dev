import i18next from 'i18next';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { ScrollView } from 'react-native';

import en from '@/i18n/en.json';
import { startOnboarded } from '@/testing/onboarded';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { lessons, totalMinutes } from './lessons';
import { loadReadProgress, saveReadProgress } from './readProgress';

import '@/i18n';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

preloadAppRoutes();

beforeEach(startOnboarded);
afterEach(async () => {
  await act(() => i18next.changeLanguage('en'));
});

const pulse = lessons[0]!;
const rhythm = lessons[1]!;

function chapterProgress(n: number, percent: number) {
  return en['learn.chapterProgress']
    .replace('{{n}}', String(n))
    .replace('{{total}}', String(lessons.length))
    .replace('{{percent}}', String(percent));
}

describe('saved reading progress', () => {
  it('only moves forward, so rereading does not lose how far a chapter was read', async () => {
    await saveReadProgress(pulse.slug, 60);
    await saveReadProgress(pulse.slug, 20);
    expect((await loadReadProgress())[pulse.slug]).toBe(60);
    await saveReadProgress(pulse.slug, 100);
    expect((await loadReadProgress())[pulse.slug]).toBe(100);
  });
});

describe('Learn tab guide card', () => {
  it('starts at chapter 1 with nothing read', async () => {
    renderRouter('./app', { initialUrl: '/learn' });
    expect(await screen.findByText(chapterProgress(1, 0))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['learn.startReading'] })).toBeOnTheScreen();
    expect(
      screen.getByText(
        en['learn.guideMeta']
          .replace('{{count}}', String(lessons.length))
          .replace('{{minutes}}', String(totalMinutes)),
      ),
    ).toBeOnTheScreen();
  });

  it('shows the saved share of the chapter in progress and continues in that chapter', async () => {
    await saveReadProgress(pulse.slug, 100);
    await saveReadProgress(rhythm.slug, 28);
    renderRouter('./app', { initialUrl: '/learn' });
    expect(await screen.findByText(chapterProgress(2, 28))).toBeOnTheScreen();
    expect(screen.getByLabelText(en['learn.bookProgress'])).toHaveProp('accessibilityValue', {
      min: 0,
      max: 100,
      now: 28,
    });
    fireEvent.press(screen.getByRole('button', { name: en['learn.continueReading'] }));
    expectNavTitle(en['learn.guideTitle']);
    expect(screen.getByRole('header', { name: en['learn.lessonRhythm'] })).toBeOnTheScreen();
  });

  it('offers to read again once every chapter is read to the end', async () => {
    for (const lesson of lessons) await saveReadProgress(lesson.slug, 100);
    renderRouter('./app', { initialUrl: '/learn' });
    expect(
      await screen.findByText(en['learn.allRead'].replace('{{total}}', String(lessons.length))),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en['learn.readAgain'] })).toBeOnTheScreen();
  });

  it('opens the Get help now screen from the BE FAST card', async () => {
    renderRouter('./app', { initialUrl: '/learn' });
    fireEvent.press(await screen.findByRole('button', { name: en['learn.beFastLabel'] }));
    expect(await screen.findByRole('button', { name: en['emergency.call'] })).toBeOnTheScreen();
  });
});

describe('reading a chapter', () => {
  function scrollTo(offsetY: number, contentHeight: number, viewportHeight: number) {
    const scroller = screen.UNSAFE_getByType(ScrollView);
    fireEvent(scroller, 'layout', { nativeEvent: { layout: { height: viewportHeight } } });
    fireEvent(scroller, 'contentSizeChange', 360, contentHeight);
    fireEvent.scroll(scroller, {
      nativeEvent: {
        contentOffset: { y: offsetY },
        contentSize: { height: contentHeight },
        layoutMeasurement: { height: viewportHeight },
      },
    });
    fireEvent(scroller, 'momentumScrollEnd');
  }

  it('saves how far down the chapter the person got', async () => {
    renderRouter('./app', { initialUrl: `/learn/${rhythm.slug}` });
    await waitFor(() => expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy());
    scrollTo(500, 2000, 500);
    await waitFor(async () => expect((await loadReadProgress())[rhythm.slug]).toBe(50));
  });

  it('counts a chapter as read when the end is reached', async () => {
    renderRouter('./app', { initialUrl: `/learn/${rhythm.slug}` });
    await waitFor(() => expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy());
    scrollTo(1500, 2000, 500);
    await waitFor(async () => expect((await loadReadProgress())[rhythm.slug]).toBe(100));
  });

  it('scrolls back to where the person stopped', async () => {
    await saveReadProgress(rhythm.slug, 50);
    renderRouter('./app', { initialUrl: `/learn/${rhythm.slug}` });
    await waitFor(() => expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy());
    const scroller = screen.UNSAFE_getByType(ScrollView);
    const scrollToSpy = jest.spyOn(scroller.instance as ScrollView, 'scrollTo');
    fireEvent(scroller, 'layout', { nativeEvent: { layout: { height: 500 } } });
    fireEvent(scroller, 'contentSizeChange', 360, 2000);
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledWith({ y: 500, animated: false }));
  });
});
