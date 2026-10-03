import { renderRouter, screen } from 'expo-router/testing-library';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { resyncNotifications } from '@/settings/applyPrefs';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('@/settings/applyPrefs', () => ({
  ...jest.requireActual('@/settings/applyPrefs'),
  resyncNotifications: jest.fn(),
}));

jest.setTimeout(30_000);
preloadAppRoutes();

beforeEach(emptyMockDatabases);

describe('the root layout', () => {
  it('re-syncs the reminders once when the app opens', async () => {
    renderRouter('./app', { initialUrl: '/follow-up' });
    await screen.findByRole('header', { name: en['followUp.title'] });
    expect(resyncNotifications).toHaveBeenCalledTimes(1);
  });
});
