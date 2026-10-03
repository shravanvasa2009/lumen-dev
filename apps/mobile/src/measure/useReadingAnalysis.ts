import { useEffect, useState } from 'react';

import { keepDemoReading } from '@/demo/demoReadings';
import { resyncNotifications } from '@/settings/applyPrefs';
import { saveReading } from '@/store/readings';

import { analyzeKeptCapture, type AnalysisRequest } from './analyzeKeptCapture';
import { type AnalysisProgress, pendingProgress } from './analysisProgress';
import { type KeptCapture, keptCapture } from './keptCapture';
import { DEFAULT_MODE } from './mode';

export type AnalysisState =
  | { phase: 'unavailable' }
  | { phase: 'running'; progress: AnalysisProgress }
  | { phase: 'done'; progress: AnalysisProgress; readingId: string }
  | { phase: 'failed'; progress: AnalysisProgress; reason: string };

// The Processing route always passes what pre-check recorded; this is only for a caller that has none.
const DEFAULT_REQUEST: AnalysisRequest = { mode: DEFAULT_MODE, restTimerDone: false };

type Tracker = { latest: AnalysisProgress; listeners: Set<(progress: AnalysisProgress) => void> };
type Run = { tracker: Tracker; outcome: Promise<{ readingId: string; progress: AnalysisProgress }> };

// One analysis and one save per kept capture, however many times the screen mounts or its params change:
// a second run would store the same reading again. A failed run is forgotten so the next mount can retry.
const runs = new WeakMap<KeptCapture, Run>();

function runFor(capture: KeptCapture, { mode, restTimerDone }: AnalysisRequest): Run {
  const existing = runs.get(capture);
  if (existing !== undefined) return existing;
  const tracker: Tracker = { latest: pendingProgress, listeners: new Set() };
  const outcome = analyzeKeptCapture(capture, { mode, restTimerDone }, (progress) => {
    tracker.latest = progress;
    for (const listener of tracker.listeners) listener(progress);
  }).then(async (analysed) => {
    const { readingId, recordedMs, context, models, reading, progress } = analysed;
    // §8.5: a Demo reading is shown from memory and never reaches the readings table.
    if (capture.demo) return { readingId: keepDemoReading(analysed, mode), progress };
    await saveReading({ id: readingId, createdAt: recordedMs, mode, context, results: reading, models });
    resyncNotifications();
    return { readingId, progress };
  });
  outcome.catch(() => runs.delete(capture));
  const run = { tracker, outcome };
  runs.set(capture, run);
  return run;
}

// The Processing screen's steps. The capture was kept by useLiveCapture; with none (the module is not linked,
// or nothing was recorded) there is nothing to analyse and the state stays unavailable rather than inventing
// progress. The kept capture is read once per mount, so a new one stored mid-transition cannot restart the
// analysis.
export function useReadingAnalysis(request: AnalysisRequest = DEFAULT_REQUEST): AnalysisState {
  const [capture] = useState(keptCapture);
  const { mode, restTimerDone } = request;
  const [state, setState] = useState<AnalysisState>(
    capture === null ? { phase: 'unavailable' } : { phase: 'running', progress: pendingProgress },
  );

  useEffect(() => {
    if (capture === null) return;
    let active = true;
    const run = runFor(capture, { mode, restTimerDone });
    const showProgress = (progress: AnalysisProgress) => {
      if (active) setState({ phase: 'running', progress });
    };
    run.tracker.listeners.add(showProgress);
    showProgress(run.tracker.latest);
    run.outcome.then(
      ({ readingId, progress }) => {
        if (active) setState({ phase: 'done', progress, readingId });
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Reading analysis failed: ${reason}`);
        if (active) setState({ phase: 'failed', progress: run.tracker.latest, reason });
      },
    );
    return () => {
      active = false;
      run.tracker.listeners.delete(showProgress);
    };
  }, [capture, mode, restTimerDone]);

  return state;
}
