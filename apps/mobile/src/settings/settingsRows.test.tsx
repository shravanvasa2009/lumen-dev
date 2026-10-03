import * as Sharing from 'expo-sharing';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import i18next from 'i18next';

import { exitDemo, isDemoActive } from '@/demo/demoSession';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import { syncNotifications } from '@/notifications/scheduler';
import { lumenDatabase } from '@/store/database';
import { profileValue, setProfileValue } from '@/store/profile';
import { saveReading } from '@/store/readings';
import { memoryFiles } from '@/testing/memoryFiles';
import { expectNavTitle } from '@/testing/navHeader';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { makeReading } from '@/testing/reading';

jest.mock('expo-file-system', () => jest.requireActual('@/testing/memoryFiles').mockFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/notifications/scheduler', () => ({ syncNotifications: jest.fn(async () => undefined) }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'dark',
}));

const sync = jest.mocked(syncNotifications);
const isAvailable = jest.mocked(Sharing.isAvailableAsync);
const share = jest.mocked(Sharing.shareAsync);

preloadAppRoutes();

beforeEach(async () => {
  jest.clearAllMocks();
  sync.mockImplementation(async () => undefined);
  memoryFiles.clear();
  await startOnboarded();
  isAvailable.mockResolvedValue(true);
  share.mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  exitDemo();
  await act(() => i18next.changeLanguage('en'));
});

const escaped = (text: string) => text.replace(/[()]/g, String.raw`\$&`);
const row = (title: string) => screen.findByRole('button', { name: new RegExp(escaped(title)) });

async function saveOwnReading(takenAt: number, mode: 'quick' | 'full') {
  const { id, outcome } = makeReading(takenAt, 66, 44);
  await saveReading({
    id,
    createdAt: takenAt,
    mode,
    context: {} as never,
    results: outcome,
    models: { rhythm: null, diabetes: null },
  });
}

describe('Language row', () => {
  it('shows the device language, then switches the whole app at once and saves the choice', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.language']));
    expect(screen.getByRole('radio', { name: en['language.en'] })).toBeChecked();
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    expect(await screen.findByRole('header', { name: es['settings.title'] })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: es['language.es'] })).toBeChecked();
    await waitFor(async () => expect(await profileValue('language')).toBe('es'));
  });

  it('plans the scheduled reminders again in the new language', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.language']));
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    await waitFor(() => expect(sync.mock.lastCall?.[1]).toBe('es'));
  });

  it('plans the reminders in the new language even when the choice could not be saved', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.language']));
    const database = await lumenDatabase();
    jest.spyOn(database, 'runAsync').mockRejectedValueOnce(new Error('disk full'));
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    await waitFor(() => expect(sync.mock.lastCall?.[1]).toBe('es'));
    expect(await screen.findByText(es['settings.languageNotSaved'])).toBeOnTheScreen();
  });

  it('says so when the reminders could not be updated', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The launch re-sync runs in English and must not be the call that fails.
    sync.mockImplementation(async (_plan, languageTag) => {
      if (languageTag === 'es') throw new Error('scheduler down');
    });
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.language']));
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    expect(await screen.findByText(es['settings.languageRemindersFailed'])).toBeOnTheScreen();
  });

  it('opens in the saved language on the next launch', async () => {
    await setProfileValue('language', 'es');
    renderRouter('./app', { initialUrl: '/settings' });
    expect(await screen.findByRole('header', { name: es['settings.title'] })).toBeOnTheScreen();
  });

  it('keeps the device language when the saved value is not a language we have', async () => {
    await setProfileValue('language', 'fr');
    renderRouter('./app', { initialUrl: '/settings' });
    expect(await screen.findByRole('header', { name: en['settings.title'] })).toBeOnTheScreen();
  });

  it('says so when the choice could not be saved, and still switches', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.language']));
    const database = await lumenDatabase();
    jest.spyOn(database, 'runAsync').mockRejectedValueOnce(new Error('disk full'));
    fireEvent.press(screen.getByRole('radio', { name: es['language.es'] }));
    expect(await screen.findByText(es['settings.languageNotSaved'])).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: es['settings.title'] })).toBeOnTheScreen();
  });
});

describe('Demo mode row', () => {
  it('starts the demo session and opens Home', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.demoMode']));
    await waitFor(() => expect(isDemoActive()).toBe(true));
    expect(
      await screen.findByRole('header', { name: /^Good (morning|afternoon|evening)/ }),
    ).toBeOnTheScreen();
  });
});

describe('Export row', () => {
  it('shares only the readings saved on this phone as a CSV and removes the file afterwards', async () => {
    await saveOwnReading(Date.UTC(2026, 9, 1, 8), 'quick');
    await saveOwnReading(Date.UTC(2026, 9, 2, 8), 'full');
    let shared = '';
    share.mockImplementation(async (uri) => {
      shared = memoryFiles.get(uri) ?? '';
    });
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.export']));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith('lumen-readings.csv', {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });
    expect(shared.split('\n').filter(Boolean)).toHaveLength(3);
    expect(shared).toContain('2026-10-01T08:00:00.000Z,quick,66');
    expect(shared).toContain('2026-10-02T08:00:00.000Z,full,66');
    expect(memoryFiles.size).toBe(0);
  });

  it('says there is nothing to export, and opens no share sheet, when no readings are saved', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.export']));
    expect(await screen.findByText(en['settings.exportEmpty'])).toBeOnTheScreen();
    expect(share).not.toHaveBeenCalled();
  });

  it('says so when sharing is unavailable', async () => {
    await saveOwnReading(1, 'quick');
    isAvailable.mockResolvedValue(false);
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.export']));
    expect(await screen.findByText(en['settings.exportUnavailable'])).toBeOnTheScreen();
    expect(share).not.toHaveBeenCalled();
  });

  it('says so, and still removes the file, when the share sheet fails', async () => {
    await saveOwnReading(1, 'quick');
    share.mockRejectedValue(new Error('no apps'));
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.export']));
    expect(await screen.findByText(en['settings.exportFailed'])).toBeOnTheScreen();
    expect(memoryFiles.size).toBe(0);
  });
});

describe('About row', () => {
  it('shows the notice, and opens the accuracy screen', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    expect(screen.queryByText(en['settings.aboutBody'])).toBeNull();
    fireEvent.press(await row(en['settings.about']));
    expect(screen.getByText(en['settings.aboutBody'])).toBeOnTheScreen();
    expect(screen.getByText(en['prototype.banner'])).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['settings.aboutAccuracy'] }));
    expectNavTitle(en['accuracy.title']);
  });

  it('closes again on a second tap', async () => {
    renderRouter('./app', { initialUrl: '/settings' });
    fireEvent.press(await row(en['settings.about']));
    fireEvent.press(screen.getByRole('button', { name: new RegExp(escaped(en['settings.about'])) }));
    expect(screen.queryByText(en['settings.aboutBody'])).toBeNull();
  });
});
