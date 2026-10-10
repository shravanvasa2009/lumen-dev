import type { ReadingResult } from '@lumen/core';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import en from '@/i18n/en.json';
import { listReadings, saveReading } from '@/store/readings';
import { startOnboarded } from '@/testing/onboarded';
import { preloadAppRoutes } from '@/testing/preloadAppRoutes';
import { makeReading } from '@/testing/reading';

import type { LiveCapture } from './useLiveCapture';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

let mockLive: LiveCapture;
jest.mock('./useLiveCapture', () => ({ useLiveCapture: () => mockLive }));

jest.setTimeout(30_000);

preloadAppRoutes();

const running: LiveCapture = {
  phase: 'running',
  failure: null,
  status: null,
  recentRed: [],
  recentRedTS: [],
  recentPulse: [],
  elapsedS: 5,
  cleanSeconds: null,
  coachingKey: null,
  recentWaveform: { tS: [], ppg: [] },
  rejectedSpans: [],
  signalLevel: null,
  nativeCamera: false,
  advancing: false,
  adjustingExposure: false,
};

const FIRST_TAKEN_AT = new Date(2026, 9, 1, 6, 30).getTime();

async function saveReadings(headlines: readonly ReadingResult['headlineKey'][]): Promise<void> {
  for (const [index, headlineKey] of headlines.entries()) {
    const takenAt = FIRST_TAKEN_AT + index * 60_000;
    const { id, outcome } = makeReading(takenAt, 70, 40);
    await saveReading({
      id,
      createdAt: takenAt,
      mode: 'quick',
      context: {
        captureFps: 60,
        tier: null,
        mode: 'quick',
        restTimerDone: true,
        recordedAt: null,
        motionSpans: [],
        coldHandsSpans: [],
        sqi: null,
        validationRhythmLabel: null,
      },
      results: { ...outcome, headlineKey },
      models: { rhythm: null, diabetes: null },
      intervalsMs: [],
    });
  }
}

// Lets the screen's own read of the saved readings finish before a test asserts that nothing folded.
async function readSettled(): Promise<void> {
  await act(async () => {
    await listReadings();
  });
}

const FLAT = en['precheck.reminderFlat'];
const FOLDED_ROW = { name: en['precheck.reminders'] };

beforeEach(startOnboarded);

describe('pre-check reminders', () => {
  it('shows the tips in full before three conclusive readings', async () => {
    await saveReadings(['result.regular', 'result.regular']);
    renderRouter('./app', { initialUrl: '/measure/precheck?mode=quick' });
    await readSettled();
    expect(screen.getByText(FLAT)).toBeOnTheScreen();
    expect(screen.queryByRole('button', FOLDED_ROW)).toBeNull();
  });

  it('does not count inconclusive readings', async () => {
    await saveReadings(['result.regular', 'result.regular', 'result.inconclusive', 'result.inconclusive']);
    renderRouter('./app', { initialUrl: '/measure/precheck?mode=quick' });
    await readSettled();
    expect(screen.getByText(FLAT)).toBeOnTheScreen();
    expect(screen.queryByRole('button', FOLDED_ROW)).toBeNull();
  });

  it('folds to one row after three conclusive readings and opens on press', async () => {
    await saveReadings(['result.regular', 'result.uncertain', 'result.irregularRetake']);
    renderRouter('./app', { initialUrl: '/measure/precheck?mode=quick' });
    const row = await screen.findByRole('button', FOLDED_ROW);
    expect(row).toBeCollapsed();
    expect(screen.queryByText(FLAT)).toBeNull();
    fireEvent.press(row);
    expect(screen.getByText(FLAT)).toBeOnTheScreen();
    expect(screen.getByRole('button', FOLDED_ROW)).toBeExpanded();
    fireEvent.press(screen.getByRole('button', FOLDED_ROW));
    expect(screen.queryByText(FLAT)).toBeNull();
  });
});

describe('capture tips button', () => {
  it('opens the same tips and leaves the reading running', () => {
    mockLive = running;
    const route = renderRouter('./app', { initialUrl: '/measure/capture?mode=quick' });
    expect(screen.queryByText(FLAT)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: en['capture.tips'] }));
    expect(screen.getByText(FLAT)).toBeOnTheScreen();
    expect(screen.getByText(en['precheck.reminderElbows'])).toBeOnTheScreen();
    expect(route.getPathname()).toBe('/measure/capture');
    fireEvent.press(screen.getByRole('button', { name: en['safety.dismiss'] }));
    expect(screen.queryByText(FLAT)).toBeNull();
    expect(screen.getByRole('button', { name: en['capture.stop'] })).toBeOnTheScreen();
  });

  // Control for the SafetySheet scrim tests: the same element does close a sheet that has a dismiss handler.
  it('closes when the scrim is tapped', () => {
    mockLive = running;
    renderRouter('./app', { initialUrl: '/measure/capture?mode=quick' });
    fireEvent.press(screen.getByRole('button', { name: en['capture.tips'] }));
    expect(screen.getByText(FLAT)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('sheet-scrim-press'));
    expect(screen.queryByText(FLAT)).toBeNull();
  });
});
