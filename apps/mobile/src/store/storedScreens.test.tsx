import type { RhythmMetric } from '@lumen/core';
import { renderHook } from '@testing-library/react-native';
import { type ReactNode, Component } from 'react';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { fixClockAtMorning } from '@/testing/fixClockAtMorning';
import { expectNavTitle } from '@/testing/navHeader';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { startOnboarded } from '@/testing/onboarded';
import { makeReading } from '@/testing/reading';

import { lumenDatabase } from './database';
import { saveReading } from './readings';
import { useStoredReading } from './useStoredReadings';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

preloadAppRoutes();

fixClockAtMorning();

// The fixed clock is Thursday, Oct 1, 2026 in the morning; this reading was taken at 06:30 that day.
const TAKEN_AT = new Date(2026, 9, 1, 6, 30).getTime();
const ID = `reading-${TAKEN_AT}`;

// A regular rhythm card, as the analysis saves it for a steady pulse.
const SINUS: RhythmMetric = {
  class: 'sinus',
  pAF: 0.05,
  evidence: 'experimental',
  confidence: 'moderate',
  flag: null,
  quality: 'standard',
  qualityReasons: [],
  qualityDetails: [],
};

async function saveHeartRate(
  hr: number,
  { rhythm = null, intervalsMs = [] }: { rhythm?: RhythmMetric | null; intervalsMs?: number[] } = {},
): Promise<void> {
  const { outcome } = makeReading(TAKEN_AT, hr, 48);
  outcome.metrics.rhythm = rhythm;
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
    intervalsMs,
  });
}

beforeEach(startOnboarded);

afterEach(() => jest.restoreAllMocks());

describe('Home with a saved reading', () => {
  it('shows its HRV finding on the HRV card, with its heart rate in the latest reading', async () => {
    await saveHeartRate(71);
    renderRouter('./app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('48 ms')).toBeOnTheScreen());
    expect(screen.getAllByText(en['home.noReadings'])).toHaveLength(2);
    expect(screen.getByText('71')).toBeOnTheScreen();
  });

  it('opens that reading from the latest reading card', async () => {
    await saveHeartRate(71);
    renderRouter('./app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('48 ms')).toBeOnTheScreen());
    fireEvent.press(
      screen.getByRole('button', {
        name: new RegExp(`^${en['results.rhythmTooShort']}|^${en['home.latestSaved']}`),
      }),
    );
    await waitFor(() => expectNavTitle(en['results.title']));
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('still shows the empty state when nothing is saved', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getAllByText(en['home.noReadings'])).toHaveLength(3));
  });
});

describe('a failed read', () => {
  afterEach(() => jest.restoreAllMocks());

  // Nothing catches it in the hook: it is thrown while rendering, for whichever error boundary is above.
  it('is thrown from useStoredReading rather than shown as a missing reading', async () => {
    const database = await lumenDatabase();
    jest.spyOn(database, 'getFirstAsync').mockRejectedValue(new Error('the reading file is unreadable'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const caught = jest.fn();
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      override state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      override componentDidCatch(error: Error) {
        caught(error.message);
      }
      override render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    renderHook(() => useStoredReading(ID), { wrapper: Boundary });
    await waitFor(() => expect(caught).toHaveBeenCalledWith('the reading file is unreadable'));
  });
});

describe('Results for a saved reading id', () => {
  it('shows the saved reading without the sample-data banner', async () => {
    await saveHeartRate(71);
    renderRouter('./app', { initialUrl: `/results/${ID}` });
    await waitFor(() => expectNavTitle(en['results.title']));
    expect(screen.getAllByText('71')[0]).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('shows the error screen when the reading cannot be read, and Try again opens Home', async () => {
    await saveHeartRate(71);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(await lumenDatabase(), 'getFirstAsync').mockRejectedValueOnce(new Error('unreadable'));
    renderRouter('./app', { initialUrl: `/results/${ID}` });
    expect(await screen.findByRole('header', { name: en['error.title'] })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en['error.retry'] }));
    expect(await screen.findByText('48 ms')).toBeOnTheScreen();
  });

  it('shows no values for an id that was never saved', async () => {
    renderRouter('./app', { initialUrl: '/results/reading-1' });
    await waitFor(() => expect(screen.getByText(en['result.inconclusive'])).toBeOnTheScreen());
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });
});

describe('Why regular for a saved reading', () => {
  const intervalsMs = [930, 945, 962, 951, 938, 921, 915, 929];

  it('draws the saved beat intervals, with no sample-data banner', async () => {
    await saveHeartRate(64, { rhythm: SINUS, intervalsMs });
    renderRouter('./app', { initialUrl: `/results/${ID}/why` });
    expect(await screen.findByText(en['why.titleRegular'])).toBeOnTheScreen();
    expect(
      screen.getByLabelText(en['why.intervalsChart'].replace('{{beats}}', String(intervalsMs.length))),
    ).toBeOnTheScreen();
    expect(screen.queryByText(en['demo.banner'])).toBeNull();
  });

  it('keeps the no-chart screen for a reading saved without intervals', async () => {
    await saveHeartRate(64, { rhythm: SINUS });
    renderRouter('./app', { initialUrl: `/results/${ID}/why` });
    expect(await screen.findByRole('header', { name: en['result.inconclusive'] })).toBeOnTheScreen();
    expect(screen.queryByText(en['why.titleRegular'])).toBeNull();
  });
});
