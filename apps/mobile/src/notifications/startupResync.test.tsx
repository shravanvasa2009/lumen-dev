import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { resyncNotifications } from '@/settings/applyPrefs';
import { setProfileValue } from '@/store/profile';
import { publishWidgetCopy } from '@/widgets/publish';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('@/settings/applyPrefs', () => ({
  ...jest.requireActual('@/settings/applyPrefs'),
  resyncNotifications: jest.fn(),
}));

jest.mock('@/widgets/publish', () => ({
  ...jest.requireActual('@/widgets/publish'),
  publishWidgetCopy: jest.fn(async () => undefined),
}));

jest.setTimeout(30_000);
preloadAppRoutes();

beforeEach(() => {
  emptyMockDatabases();
  jest.mocked(resyncNotifications).mockClear();
  jest.mocked(publishWidgetCopy).mockClear();
});

afterEach(() => i18next.changeLanguage('en'));

describe('the root layout', () => {
  it('re-syncs the reminders once when the app opens', async () => {
    renderRouter('./app', { initialUrl: '/follow-up' });
    await screen.findByRole('header', { name: en['followUp.title'] });
    expect(resyncNotifications).toHaveBeenCalledTimes(1);
  });

  // A widget placed before the first reading otherwise keeps the native fallback, without the four checks.
  it('publishes the widget copy once when the app opens', async () => {
    renderRouter('./app', { initialUrl: '/follow-up' });
    await screen.findByRole('header', { name: en['followUp.title'] });
    await waitFor(() => expect(publishWidgetCopy).toHaveBeenCalledTimes(1));
  });

  it('re-syncs after the saved language is applied, so reminders are planned in it', async () => {
    await setProfileValue('language', 'es');
    const languageAtSync: string[] = [];
    jest.mocked(resyncNotifications).mockImplementation(async () => {
      languageAtSync.push(i18next.language);
      return true;
    });
    renderRouter('./app', { initialUrl: '/follow-up' });
    await screen.findByRole('header', { name: en['followUp.title'] });
    await waitFor(() => expect(resyncNotifications).toHaveBeenCalledTimes(1));
    expect(languageAtSync).toEqual(['es']);
  });
});
