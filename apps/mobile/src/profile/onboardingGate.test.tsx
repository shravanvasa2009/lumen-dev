import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { redirectSystemPath } from '@/deepLinks';
import en from '@/i18n/en.json';
import { lumenDatabase } from '@/store/database';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  useLastNotificationResponse: () => null,
  setNotificationHandler: jest.fn(),
}));

preloadAppRoutes();

const WELCOME_TAGLINE = en['app.tagline'];
const HOME_GREETING = /^Good (morning|afternoon|evening)/;

afterEach(() => jest.restoreAllMocks());

describe('first-launch gate', () => {
  it('opens a fresh install on Welcome', async () => {
    emptyMockDatabases();
    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText(WELCOME_TAGLINE)).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: HOME_GREETING })).toBeNull();
  });

  it('opens Home on the next launch once onboarding has been finished', async () => {
    emptyMockDatabases();
    const firstLaunch = renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.notNow'] }));
    expect(await screen.findByRole('header', { name: HOME_GREETING })).toBeOnTheScreen();
    firstLaunch.unmount();

    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: HOME_GREETING })).toBeOnTheScreen();
    expect(screen.queryByText(WELCOME_TAGLINE)).toBeNull();
  });

  it('shows Home for "Try demo mode" without marking onboarding done', async () => {
    emptyMockDatabases();
    const firstLaunch = renderRouter('./app', { initialUrl: '/welcome' });
    fireEvent.press(screen.getByRole('button', { name: en['welcome.tryDemo'] }));
    expect(await screen.findByRole('header', { name: HOME_GREETING })).toBeOnTheScreen();
    firstLaunch.unmount();

    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText(WELCOME_TAGLINE)).toBeOnTheScreen();
  });

  it('keeps the person on Reminders and says so when finishing cannot be saved', async () => {
    emptyMockDatabases();
    jest.spyOn(await lumenDatabase(), 'runAsync').mockRejectedValue(new Error('disk full'));
    renderRouter('./app', { initialUrl: '/reminders' });
    fireEvent.press(screen.getByRole('button', { name: en['reminders.notNow'] }));
    await waitFor(() => expect(screen.getByText(en['profile.saveFailed'])).toBeOnTheScreen());
    expect(screen.getByRole('header', { name: en['reminders.title'] })).toBeOnTheScreen();
  });

  it('follows a widget link to the Quick Check for an onboarded user', async () => {
    await startOnboarded();
    renderRouter('./app', { initialUrl: redirectSystemPath({ path: 'lumen://check' }) });
    expect(await screen.findByRole('button', { name: en['precheck.start'] })).toBeOnTheScreen();
  });
});
