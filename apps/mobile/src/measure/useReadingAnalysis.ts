import { useEffect, useState } from 'react';

import { saveReading } from '@/store/readings';

import { analyzeKeptCapture, type AnalysisRequest } from './analyzeKeptCapture';
import { type AnalysisProgress, pendingProgress } from './analysisProgress';
import { keptCapture, type KeptCapture } from './keptCapture';
import { DEFAULT_MODE } from './mode';

export type AnalysisState =
  | { phase: 'unavailable' }
  | { phase: 'running'; progress: AnalysisProgress }
  | { phase: 'done'; progress: AnalysisProgress; readingId: string }
  | { phase: 'failed'; progress: AnalysisProgress; reason: string };

// The Processing route always passes what pre-check recorded; this is only for a caller that has none.
const DEFAULT_REQUEST: AnalysisRequest = { mode: DEFAULT_MODE, restTimerDone: false };

function useAnalysisOf(capture: KeptCapture, { mode, restTimerDone }: AnalysisRequest): AnalysisState {
  const [state, setState] = useState<AnalysisState>({ phase: 'running', progress: pendingProgress });

  useEffect(() => {
    let active = true;
    let latest = pendingProgress;
    analyzeKeptCapture(capture, { mode, restTimerDone }, (progress) => {
      latest = progress;
      if (active) setState({ phase: 'running', progress });
    })
      .then(async ({ readingId, recordedMs, context, models, reading, progress }) => {
        await saveReading({ id: readingId, createdAt: recordedMs, mode, context, results: reading, models });
        return { readingId, progress };
      })
      .then(
        ({ readingId, progress }) => {
          if (active) setState({ phase: 'done', progress, readingId });
        },
        (error: unknown) => {
          if (active)
            setState({
              phase: 'failed',
              progress: latest,
              reason: error instanceof Error ? error.message : String(error),
            });
        },
      );
    return () => {
      active = false;
    };
  }, [capture, mode, restTimerDone]);

  return state;
}

// The Processing screen's steps. The capture was kept by useLiveCapture; with none (the module is not linked,
// or nothing was recorded) there is nothing to analyse and the state stays unavailable rather than inventing
// progress. Only the capture screen writes the store and it is gone before Processing mounts, so within one
// mount the branch below never changes and the hooks run in the same order every render.
export function useReadingAnalysis(request: AnalysisRequest = DEFAULT_REQUEST): AnalysisState {
  const capture = keptCapture();
  if (capture === null) return { phase: 'unavailable' };
  return useAnalysisOf(capture, request);
}
