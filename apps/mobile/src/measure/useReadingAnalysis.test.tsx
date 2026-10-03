import { renderHook, waitFor } from '@testing-library/react-native';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { resyncNotifications } from '@/settings/applyPrefs';
import { lumenDatabase } from '@/store/database';
import { listReadings } from '@/store/readings';
import { makeReading } from '@/testing/reading';

import { type AnalysedReading, type AnalysisRequest, analyzeKeptCapture } from './analyzeKeptCapture';
import { pendingProgress } from './analysisProgress';
import { type KeptCapture, keepCapture } from './keptCapture';
import { type AnalysisState, useReadingAnalysis } from './useReadingAnalysis';

jest.mock('./analyzeKeptCapture', () => ({ analyzeKeptCapture: jest.fn() }));
jest.mock('@/settings/applyPrefs', () => ({
  ...jest.requireActual('@/settings/applyPrefs'),
  resyncNotifications: jest.fn(),
}));

const TAKEN_AT = 1_700_000_000_000;
const REQUEST = { mode: 'full', restTimerDone: true } as const;

const finishedProgress = {
  steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
  beats: 90,
  rejectedBeats: 2,
} as const;

function analysedReading(): AnalysedReading {
  return {
    readingId: `reading-${TAKEN_AT}`,
    recordedMs: TAKEN_AT,
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
    models: { rhythm: null, diabetes: null },
    reading: makeReading(TAKEN_AT, 64, 48).outcome,
    progress: finishedProgress,
  };
}

const newCapture = (): KeptCapture => ({
  captureFps: 60,
  lensId: null,
  samples: [],
  stats: [],
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
});

beforeEach(() => {
  emptyMockDatabases();
  keepCapture(newCapture());
  jest.mocked(resyncNotifications).mockClear();
  jest.mocked(analyzeKeptCapture).mockReset();
  jest.mocked(analyzeKeptCapture).mockImplementation(async (_capture, _request, report) => {
    report(pendingProgress);
    return analysedReading();
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  keepCapture(null);
  jest.restoreAllMocks();
});

describe('saving the analysed reading', () => {
  it('re-syncs the reminders once the reading is saved, and not when the save fails', async () => {
    const database = await lumenDatabase();
    jest.spyOn(database, 'runAsync').mockRejectedValueOnce(new Error('disk full'));
    const failed = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(failed.result.current.phase).toBe('failed'));
    expect(resyncNotifications).not.toHaveBeenCalled();
    failed.unmount();

    const saved = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(saved.result.current.phase).toBe('done'));
    expect(await listReadings()).toHaveLength(1);
    expect(resyncNotifications).toHaveBeenCalledTimes(1);
  });

  it('does not re-sync the reminders for a Demo reading, which is never stored', async () => {
    keepCapture({ ...newCapture(), demo: true });
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('done'));
    expect(await listReadings()).toEqual([]);
    expect(resyncNotifications).not.toHaveBeenCalled();
  });

  it('ends in the failed state when the reading cannot be saved', async () => {
    const database = await lumenDatabase();
    jest.spyOn(database, 'runAsync').mockRejectedValueOnce(new Error('disk full'));
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('failed'));
    expect(analysis.current).toMatchObject({ phase: 'failed', reason: 'disk full' });
    expect(await listReadings()).toEqual([]);
  });

  it('tries again on a later mount after a failed save, and stores the reading once', async () => {
    const database = await lumenDatabase();
    jest.spyOn(database, 'runAsync').mockRejectedValueOnce(new Error('disk full'));
    const first = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(first.result.current.phase).toBe('failed'));
    first.unmount();
    const second = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(second.result.current.phase).toBe('done'));
    expect(await listReadings()).toHaveLength(1);
  });

  it('analyses and saves a kept capture once across a remount and a changed request', async () => {
    const first = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(first.result.current.phase).toBe('done'));
    first.unmount();

    const second = renderHook<AnalysisState, AnalysisRequest>(useReadingAnalysis, { initialProps: REQUEST });
    await waitFor(() => expect(second.result.current.phase).toBe('done'));
    second.rerender({ mode: 'full', restTimerDone: false });
    await waitFor(() => expect(second.result.current).toMatchObject({ phase: 'done' }));

    expect(second.result.current).toMatchObject({ phase: 'done', readingId: `reading-${TAKEN_AT}` });
    expect(analyzeKeptCapture).toHaveBeenCalledTimes(1);
    expect(await listReadings()).toHaveLength(1);
  });
});
