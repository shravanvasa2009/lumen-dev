import i18next from 'i18next';
import { act } from 'react';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import en from '@/i18n/en.json';
import { expectNavTitle } from '@/testing/navHeader';
import es from '@/i18n/es.json';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { lessons } from './lessons';

import '@/i18n';

const appDirectory = './app';

afterEach(async () => {
  await act(() => i18next.changeLanguage('en'));
  jest.restoreAllMocks();
});

preloadAppRoutes();

describe('Learn tab', () => {
  it('lists every lesson with its length, then the care finder', () => {
    renderRouter(appDirectory, { initialUrl: '/learn' });
    for (const lesson of lessons) {
      expect(
        screen.getByRole('button', { name: new RegExp(lesson.title(i18next.t.bind(i18next))) }),
      ).toBeOnTheScreen();
    }
    expect(screen.getByText(en['learn.minutesAnimated'].replace('{{minutes}}', '2'))).toBeOnTheScreen();
    expect(screen.getByText(en['learn.careFinderHint'])).toBeOnTheScreen();
    expect(screen.getByText(en['learn.offline'])).toBeOnTheScreen();
  });

  it('opens the lesson that was tapped', () => {
    renderRouter(appDirectory, { initialUrl: '/learn' });
    fireEvent.press(screen.getByRole('button', { name: new RegExp(en['learn.lessonAfib']) }));
    expectNavTitle(en['learn.lessonAfib']);
  });

  it('switches the lessons to Spanish with the EN/ES toggle', async () => {
    renderRouter(appDirectory, { initialUrl: '/learn' });
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: en['learn.langSpanish'] })));
    expect(screen.getByRole('header', { name: es['learn.title'] })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: new RegExp(es['learn.lessonDiabetes']) })).toBeOnTheScreen();
  });

  it('opens the Care map when the care row is tapped', async () => {
    renderRouter(appDirectory, { initialUrl: '/learn' });
    fireEvent.press(screen.getByRole('button', { name: new RegExp(en['learn.careFinder']) }));
    expect(screen.getByRole('header', { name: en['careMap.title'] })).toBeOnTheScreen();
    await screen.findByText(en['careMap.denied']);
  });

  it('keeps the health-center website as a link that opens only when tapped', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderRouter(appDirectory, { initialUrl: '/learn' });
    expect(open).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('link', { name: en['learn.careFinderWeb'] }));
    expect(open).toHaveBeenCalledWith('https://findahealthcenter.hrsa.gov');
  });

  it('shows a line when the health-center link cannot be opened', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
    renderRouter(appDirectory, { initialUrl: '/learn' });
    expect(screen.queryByText(en['learn.careFinderFailed'])).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole('link', { name: en['learn.careFinderWeb'] })));
    expect(screen.getByText(en['learn.careFinderFailed'])).toBeOnTheScreen();
  });
});
