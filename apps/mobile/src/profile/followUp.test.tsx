import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { resyncNotifications } from '@/settings/applyPrefs';
import { lumenDatabase } from '@/store/database';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { followUpAnsweredAt, saveFollowUpAnswer } from './followUp';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

jest.mock('@/settings/applyPrefs', () => ({
  ...jest.requireActual('@/settings/applyPrefs'),
  resyncNotifications: jest.fn(),
}));

preloadAppRoutes();

const ANSWERED_AT = Date.UTC(2026, 9, 2, 15, 30);

beforeEach(() => {
  emptyMockDatabases();
  jest.mocked(resyncNotifications).mockClear();
});

afterEach(() => jest.restoreAllMocks());

describe('followUpAnsweredAt', () => {
  it('is null before the sheet has been answered', async () => {
    expect(await followUpAnsweredAt()).toBeNull();
  });

  it('returns the time of a see-doctor answer', async () => {
    await saveFollowUpAnswer('saw', ANSWERED_AT);
    expect(await followUpAnsweredAt()).toBe(ANSWERED_AT);
  });

  it.each(['booked', 'notYet'] as const)('stays null for the answer "%s"', async (answer) => {
    await saveFollowUpAnswer(answer, ANSWERED_AT);
    expect(await followUpAnsweredAt()).toBeNull();
  });

  it('follows the newest answer', async () => {
    await saveFollowUpAnswer('saw', ANSWERED_AT);
    await saveFollowUpAnswer('notYet', ANSWERED_AT + 1000);
    expect(await followUpAnsweredAt()).toBeNull();
  });
});

describe('the follow-up sheet', () => {
  beforeEach(startOnboarded);

  it('saves the answer with the time it was given, then opens Home', async () => {
    const before = Date.now();
    renderRouter('./app', { initialUrl: '/follow-up' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    fireEvent.press(screen.getByRole('button', { name: en['followUp.saw'] }));
    expect(
      await screen.findByRole('header', { name: /^Good (morning|afternoon|evening)/ }),
    ).toBeOnTheScreen();
    const savedAt = await followUpAnsweredAt();
    expect(savedAt).not.toBeNull();
    expect(savedAt).toBeGreaterThanOrEqual(before);
    expect(resyncNotifications).toHaveBeenCalledTimes(1);
  });

  it('stores "Booked" without it counting as a visit', async () => {
    renderRouter('./app', { initialUrl: '/follow-up' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    fireEvent.press(screen.getByRole('button', { name: en['followUp.booked'] }));
    await screen.findByRole('header', { name: /^Good (morning|afternoon|evening)/ });
    expect(await followUpAnsweredAt()).toBeNull();
  });

  it('stays open and says so when the answer cannot be saved', async () => {
    jest.spyOn(await lumenDatabase(), 'runAsync').mockRejectedValue(new Error('disk full'));
    renderRouter('./app', { initialUrl: '/follow-up' });
    // The app-start sync is not the one under test.
    jest.mocked(resyncNotifications).mockClear();
    fireEvent.press(screen.getByRole('button', { name: en['followUp.saw'] }));
    await waitFor(() => expect(screen.getByText(en['profile.saveFailed'])).toBeOnTheScreen());
    expect(screen.getByRole('header', { name: en['followUp.title'] })).toBeOnTheScreen();
    expect(resyncNotifications).not.toHaveBeenCalled();
  });
});
