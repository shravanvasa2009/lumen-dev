import { act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { keepCapture } from '@/measure/keptCapture';
import { followUpAnsweredAt } from '@/profile/followUp';
import { profileValue } from '@/store/profile';
import { listReadings } from '@/store/readings';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';

import { enterDemo, exitDemo } from './demoSession';

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
const DEMO_RESULTS = /^\/results\/demo-\d+$/;

// Capture runs on the fake clock because ReplayCapture batches on timers; Processing's own steps wait on
// timers too, so the clock keeps ticking until Results opens. Replay lasts 30 s of clean signal plus lead-in.
async function playUntilResults(route: { getPathname(): string }) {
  for (let elapsed = 0; elapsed < 90 && !DEMO_RESULTS.test(route.getPathname()); elapsed += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

afterEach(() => {
  act(() => exitDemo());
  keepCapture(null);
  jest.useRealTimers();
});

describe('demo session', () => {
  it('keeps the person out of Welcome across navigation until they exit', async () => {
    emptyMockDatabases();
    renderRouter('./app', { initialUrl: '/welcome' });
    fireEvent.press(screen.getByRole('button', { name: en['welcome.tryDemo'] }));
    expect(await screen.findByRole('header', { name: HOME_GREETING })).toBeOnTheScreen();
    expect(screen.getByText(en['demo.bar'])).toBeOnTheScreen();

    act(() => router.push('/settings/appearance'));
    act(() => router.replace('/'));
    expect(await screen.findByRole('header', { name: HOME_GREETING })).toBeOnTheScreen();
    expect(screen.queryByText(WELCOME_TAGLINE)).toBeNull();
  });

  it('returns to Welcome from Exit demo and gates Home again', async () => {
    emptyMockDatabases();
    renderRouter('./app', { initialUrl: '/welcome' });
    fireEvent.press(screen.getByRole('button', { name: en['welcome.tryDemo'] }));
    await screen.findByRole('header', { name: HOME_GREETING });

    fireEvent.press(screen.getByRole('button', { name: en['demo.exit'] }));
    expect(await screen.findByText(WELCOME_TAGLINE)).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.bar'])).toBeNull();

    act(() => router.replace('/'));
    expect(await screen.findByText(WELCOME_TAGLINE)).toBeOnTheScreen();
  });

  it('shows no demo bar outside demo', async () => {
    await startOnboarded();
    renderRouter('./app', { initialUrl: '/' });
    await screen.findByRole('header', { name: HOME_GREETING });
    expect(screen.queryByText(en['demo.bar'])).toBeNull();
    expect(screen.queryByRole('button', { name: en['demo.exit'] })).toBeNull();
  });

  it('plays the synthetic recording through capture and processing to a labelled result that stays out of history', async () => {
    await startOnboarded();
    enterDemo();
    jest.useFakeTimers();
    const route = renderRouter('./app', { initialUrl: '/measure/capture?mode=quick&restDone=true' });
    await playUntilResults(route);
    expect(route.getPathname()).toMatch(DEMO_RESULTS);
    expect(await screen.findByText(en['demo.banner'])).toBeOnTheScreen();
    expect(screen.getByText(en['demo.bar'])).toBeOnTheScreen();
    expect(screen.getByText(en['demo.synthetic'])).toBeOnTheScreen();

    expect(await listReadings()).toEqual([]);
    act(() => router.replace('/'));
    expect(await screen.findByText(en['home.noReadingsBody'])).toBeOnTheScreen();
  });

  it('writes nothing from the follow-up sheet in demo', async () => {
    await startOnboarded();
    enterDemo();
    renderRouter('./app', { initialUrl: '/follow-up' });
    fireEvent.press(await screen.findByRole('button', { name: en['followUp.saw'] }));
    await waitFor(() => expect(screen.queryByText(en['followUp.title'])).toBeNull());
    expect(await profileValue('followUpAnswer')).toBeNull();
    expect(await followUpAnsweredAt()).toBeNull();
  });

  it('keeps the replay running when the person exits demo mid-capture', async () => {
    await startOnboarded();
    enterDemo();
    jest.useFakeTimers();
    const route = renderRouter('./app', { initialUrl: '/measure/capture?mode=quick&restDone=true' });
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    act(() => exitDemo());
    await playUntilResults(route);
    expect(route.getPathname()).toMatch(DEMO_RESULTS);
  });

  it('hides Replay tutorial and Demo mode in Settings during demo only', async () => {
    await startOnboarded();
    renderRouter('./app', { initialUrl: '/settings' });
    expect(await screen.findByText(en['settings.replayTutorial'])).toBeOnTheScreen();
    expect(screen.getByText(en['settings.demoMode'])).toBeOnTheScreen();

    act(() => enterDemo());
    await waitFor(() => expect(screen.queryByText(en['settings.replayTutorial'])).toBeNull());
    expect(screen.queryByText(en['settings.demoMode'])).toBeNull();
  });
});
