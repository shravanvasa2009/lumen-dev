import type { InconclusiveOutcome } from '@lumen/core';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { emptyMockDatabases } from '../../__mocks__/expo-sqlite';
import { demoReadingById } from '@/demo/demoReadings';
import '@/i18n';
// Before applyPrefs: the mockFileSystem factory runs when applyPrefs loads expo-file-system.
import { mockFileSystem } from '@/testing/memoryFiles';
import { resyncNotifications } from '@/settings/applyPrefs';
import { lumenDatabase } from '@/store/database';
import { listReadings } from '@/store/readings';
import { makeReading } from '@/testing/reading';

import { type AnalysedReading, type AnalysisRequest, analyzeKeptCapture } from './analyzeKeptCapture';
import { pendingProgress } from './analysisProgress';
import { type KeptCapture, keepCapture } from './keptCapture';
import { LumenWidgets } from '../../modules/lumen-widgets/src';
import { type AnalysisState, useReadingAnalysis } from './useReadingAnalysis';

jest.mock('./analyzeKeptCapture', () => ({ analyzeKeptCapture: jest.fn() }));
jest.mock('@/settings/applyPrefs', () => ({
  ...jest.requireActual('@/settings/applyPrefs'),
  // Same contract as the real one: it never rejects and says whether the reminders were updated.
  resyncNotifications: jest.fn(async () => true),
}));
jest.mock('expo-file-system', () => mockFileSystem);
jest.mock('../../modules/lumen-widgets/src', () => ({ LumenWidgets: { publishSnapshot: jest.fn() } }));

const publishSnapshot = () => jest.mocked(LumenWidgets!.publishSnapshot);

const TAKEN_AT = 1_700_000_000_000;
const REQUEST = { mode: 'full', restTimerDone: true } as const;

const finishedProgress = {
  steps: { beats: 'done', rhythm: 'done', breathing: 'done', baseline: 'done' },
  beats: 90,
  rejectedBeats: 2,
  outputs: null,
} as const;

const INTERVALS_MS = [930, 945, 962];

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
    intervalsMs: INTERVALS_MS,
    progress: finishedProgress,
    urgent: null,
  };
}

const newCapture = (): KeptCapture => ({
  captureFps: 60,
  lensId: null,
  // Two finite frames: fewer is refused before the mocked analysis runs.
  samples: [1e12, 1e12 + 1e7].map((tNs) => ({ tNs, r: 0.7, g: 0.1, b: 0.1 })),
  stats: [1e12, 1e12 + 1e7].map((tNs) => ({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8e6 })),
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
  publishSnapshot().mockReset();
  publishSnapshot().mockResolvedValue(undefined);
});

afterEach(() => {
  keepCapture(null);
  jest.restoreAllMocks();
});

const refusal: InconclusiveOutcome = {
  kind: 'inconclusive',
  reasons: ['tooFewCleanSeconds'],
  cleanSeconds: 12,
  neededCleanSeconds: 90,
  lostSeconds: { motion: 20, pressure: 0, coverage: 0, coldHands: 0 },
  otherLostSeconds: 0,
  causes: ['motion'],
  urgent: null,
};

describe('a capture the analysis refuses', () => {
  it.each([false, true])('saves nothing and re-syncs nothing (demo: %s)', async (demo) => {
    keepCapture(demo ? { ...newCapture(), demo: true } : newCapture());
    jest.mocked(analyzeKeptCapture).mockResolvedValue(refusal);
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('inconclusive'));
    expect(analysis.current).toMatchObject({ outcome: refusal });
    expect(await listReadings()).toEqual([]);
    expect(resyncNotifications).not.toHaveBeenCalled();
  });
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

  it('saves the beat intervals with the reading', async () => {
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('done'));
    expect((await listReadings())[0]?.intervalsMs).toEqual(INTERVALS_MS);
  });

  it('keeps the beat intervals of a Demo reading in memory only', async () => {
    keepCapture({ ...newCapture(), demo: true });
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('done'));
    const done = analysis.current;
    if (done.phase !== 'done') throw new Error('the analysis did not finish');
    expect(demoReadingById(done.readingId)?.intervalsMs).toEqual(INTERVALS_MS);
    expect(await listReadings()).toEqual([]);
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

describe('updating the widgets', () => {
  it('publishes the saved reading to the widgets', async () => {
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(publishSnapshot()).toHaveBeenCalledTimes(1));
    expect(analysis.current.phase).toBe('done');
    const snapshot = JSON.parse(publishSnapshot().mock.calls[0]![0]) as {
      lastReadingAt: string;
      hrBpm: number;
    };
    expect(snapshot).toMatchObject({ lastReadingAt: '2023-11-14T22:13:20Z', hrBpm: 64 });
  });

  it('reports a failed widget update and still shows the result', async () => {
    publishSnapshot().mockRejectedValueOnce(new Error('widget store unavailable'));
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith('Widget update failed: widget store unavailable'),
    );
    expect(analysis.current.phase).toBe('done');
    expect(await listReadings()).toHaveLength(1);
  });
});

describe('urgent heart rates (SAFE-1)', () => {
  const urgent = { fastSustained: true, slowBelow40: false };

  it('hands the flags of a reading on and still saves the reading', async () => {
    jest.mocked(analyzeKeptCapture).mockResolvedValue({ ...analysedReading(), urgent });
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('done'));
    expect(analysis.current).toMatchObject({ urgent });
    expect(await listReadings()).toHaveLength(1);
  });

  it('hands the flags of a refused capture on and saves nothing', async () => {
    jest.mocked(analyzeKeptCapture).mockResolvedValue({ ...refusal, urgent });
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('inconclusive'));
    expect(analysis.current).toMatchObject({ outcome: { urgent } });
    expect(await listReadings()).toEqual([]);
  });
});

describe('a failed analysis keeps the urgent flags (SAFE-1)', () => {
  const urgent = { fastSustained: true, slowBelow40: false };

  it('keeps them when the save fails', async () => {
    jest.mocked(analyzeKeptCapture).mockImplementation(async (_capture, _request, _report, reportUrgent) => {
      reportUrgent(urgent);
      return { ...analysedReading(), urgent };
    });
    const database = await lumenDatabase();
    jest.spyOn(database, 'runAsync').mockRejectedValueOnce(new Error('disk full'));
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('failed'));
    expect(analysis.current).toMatchObject({ reason: 'disk full', urgent });
  });

  it('keeps them when a step after the outcome throws', async () => {
    jest.mocked(analyzeKeptCapture).mockImplementation(async (_capture, _request, _report, reportUrgent) => {
      reportUrgent(urgent);
      throw new Error('rhythm model unavailable');
    });
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('failed'));
    expect(analysis.current).toMatchObject({ reason: 'rhythm model unavailable', urgent });
  });

  it('has no flags when the failure came before the outcome', async () => {
    jest.mocked(analyzeKeptCapture).mockRejectedValue(new Error('no frames'));
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('failed'));
    expect(analysis.current).toMatchObject({ urgent: null });
  });
});

describe('the flags show while the analysis still runs (SAFE-1)', () => {
  const urgent = { fastSustained: true, slowBelow40: false };

  it('is unknown at first, then known before the analysis resolves', async () => {
    let finish: (reading: AnalysedReading) => void = () => {};
    jest.mocked(analyzeKeptCapture).mockImplementation(
      (_capture, _request, _report, reportUrgent) =>
        new Promise((resolve) => {
          reportUrgent(urgent);
          finish = resolve;
        }),
    );
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current).toMatchObject({ phase: 'running', urgent }));
    finish({ ...analysedReading(), urgent });
    await waitFor(() => expect(analysis.current.phase).toBe('done'));
  });

  it('notifies the screen when the flags arrive after it subscribed', async () => {
    let report: (flags: typeof urgent) => void = () => {};
    jest.mocked(analyzeKeptCapture).mockImplementation((_capture, _request, _report, reportUrgent) => {
      report = reportUrgent;
      return new Promise(() => {});
    });
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current).toMatchObject({ phase: 'running', urgent: undefined }));
    act(() => report(urgent));
    expect(analysis.current).toMatchObject({ phase: 'running', urgent });
  });

  it('leaves it undefined while the rules have not run', async () => {
    jest.mocked(analyzeKeptCapture).mockImplementation(() => new Promise(() => {}));
    const { result: analysis } = renderHook(() => useReadingAnalysis(REQUEST));
    await waitFor(() => expect(analysis.current.phase).toBe('running'));
    expect(analysis.current).toMatchObject({ urgent: undefined });
  });
});
