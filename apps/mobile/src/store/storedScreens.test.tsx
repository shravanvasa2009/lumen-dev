import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import en from '@/i18n/en.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { makeReading } from '@/testing/reading';

import { saveReading } from './readings';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

preloadAppRoutes();

fixClockAtMorning();

// The fixed clock is Thursday, Oct 1, 2026 in the morning; this reading was taken at 06:30 that day.
const TAKEN_AT = new Date(2026, 9, 1, 6, 30).getTime();
const ID = `reading-${TAKEN_AT}`;
const TODAY_LINE = /^Today, /;

async function saveHeartRate(hr: number): Promise<void> {
  const { outcome } = makeReading(TAKEN_AT, hr, 48);
  await saveReading({
    id: ID,
    createdAt: TAKEN_AT,
    mode: 'full',
    context: {
      captureFps: 60,
      tier: null,
      mode: 'full',
      restTimerDone: true,
      recordedAt: null,
      motionSpans: [],
      coldHandsSpans: [],
      sqi: null,
      validationRhythmLabel: null,
    },
    results: outcome,
    models: { rhythm: null, diabetes: null },
  });
}

beforeEach(emptyMockDatabases);

describe('Home with a saved reading', () => {
  it('shows it as the latest result, with its heart rate on the tile', async () => {
    await saveHeartRate(71);
    renderRouter('./app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText(TODAY_LINE)).toBeOnTheScreen());
    expect(screen.queryByText(en['home.noReadings'])).toBeNull();
    expect(screen.getByText('71')).toBeOnTheScreen();
  });

  it('opens that reading from the latest result card', async () => {
    await saveHeartRate(71);
    renderRouter('./app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText(TODAY_LINE)).toBeOnTheScreen());
    fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${en['home.latestResult']}`) }));
    await waitFor(() => expect(screen.getByRole('header', { name: en['results.title'] })).toBeOnTheScreen());
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('still shows the empty state when nothing is saved', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText(en['home.noReadings'])).toBeOnTheScreen());
  });
});

describe('Results for a saved reading id', () => {
  it('shows the saved reading without the sample-data banner', async () => {
    await saveHeartRate(71);
    renderRouter('./app', { initialUrl: `/results/${ID}` });
    await waitFor(() => expect(screen.getByRole('header', { name: en['results.title'] })).toBeOnTheScreen());
    expect(screen.getByText('71 bpm')).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('shows no values for an id that was never saved', async () => {
    renderRouter('./app', { initialUrl: '/results/reading-1' });
    await waitFor(() => expect(screen.getByText(en['result.inconclusive'])).toBeOnTheScreen());
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });
});
