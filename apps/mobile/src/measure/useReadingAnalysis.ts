import type { InconclusiveOutcome } from '@lumen/core';
import { useEffect, useState } from 'react';

import { keepDemoReading } from '@/demo/demoReadings';
import { resyncNotifications } from '@/settings/applyPrefs';
import { saveReading } from '@/store/readings';
import { currentPreferences } from '@/theme/preferences';
import { publishWidgets } from '@/widgets/publish';

import { analyzeKeptCapture, type AnalysisRequest } from './analyzeKeptCapture';
import { type AnalysisProgress, pendingProgress } from './analysisProgress';
import { isTooShort } from './captureRefusal';
import { type KeptCapture, keptCapture } from './keptCapture';
import { DEFAULT_MODE } from './mode';

export type AnalysisState =
  | { phase: 'unavailable' }
  | { phase: 'running'; progress: AnalysisProgress }
  | { phase: 'done'; progress: AnalysisProgress; readingId: string }
  // A refused capture is not a reading: nothing is saved and Processing opens the Inconclusive screen. The
  // outcome is null for a capture too short to analyse, which has no numbers to show.
  | { phase: 'inconclusive'; progress: AnalysisProgress; outcome: InconclusiveOutcome | null }
  | { phase: 'failed'; progress: AnalysisProgress; reason: string };

// The Processing route always passes what pre-check recorded; this is only for a caller that has none.
const DEFAULT_REQUEST: AnalysisRequest = { mode: DEFAULT_MODE, restTimerDone: false };

type Tracker = { latest: AnalysisProgress; listeners: Set<(progress: AnalysisProgress) => void> };
type Finished =
  | { kind: 'reading'; readingId: string; progress: AnalysisProgress }
  | { kind: 'inconclusive'; outcome: InconclusiveOutcome | null };
type Run = { tracker: Tracker; outcome: Promise<Finished> };

// One analysis and one save per kept capture, however many times the screen mounts or its params change:
// a second run would store the same reading again. A failed run is forgotten so the next mount can retry.
const runs = new WeakMap<KeptCapture, Run>();

function runFor(capture: KeptCapture, { mode, restTimerDone }: AnalysisRequest): Run {
  const existing = runs.get(capture);
  if (existing !== undefined) return existing;
  const tracker: Tracker = { latest: pendingProgress, listeners: new Set() };
  if (isTooShort(capture)) {
    const refused: Run = { tracker, outcome: Promise.resolve({ kind: 'inconclusive', outcome: null }) };
    runs.set(capture, refused);
    return refused;
  }
  const outcome = analyzeKeptCapture(capture, { mode, restTimerDone }, (progress) => {
    tracker.latest = progress;
    for (const listener of tracker.listeners) listener(progress);
  }).then(async (analysed): Promise<Finished> => {
    if ('kind' in analysed) return { kind: 'inconclusive', outcome: analysed };
    const { readingId, recordedMs, context, models, reading, progress } = analysed;
    // §8.5: a Demo reading is shown from memory and never reaches the readings table.
    if (capture.demo) return { kind: 'reading', readingId: keepDemoReading(analysed, mode), progress };
    await saveReading({ id: readingId, createdAt: recordedMs, mode, context, results: reading, models });
    // Spec §9.6: the widgets show the new reading. They publish after the reminders are re-planned, so the
    // widget's next check time is current. The reading is already saved, so a failed widget write is reported
    // and the result screen still opens; the widget keeps its previous snapshot.
    void resyncNotifications().then(() =>
      publishWidgets(currentPreferences()).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Widget update failed: ${reason}`);
      }),
    );
    return { kind: 'reading', readingId, progress };
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
      (finished) => {
        if (!active) return;
        if (finished.kind === 'inconclusive')
          setState({ phase: 'inconclusive', progress: run.tracker.latest, outcome: finished.outcome });
        else setState({ phase: 'done', progress: finished.progress, readingId: finished.readingId });
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
