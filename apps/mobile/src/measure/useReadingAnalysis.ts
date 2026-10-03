import { useEffect, useState } from 'react';

import { analyzeKeptCapture, type AnalysisRequest } from './analyzeKeptCapture';
import { type AnalysisProgress, pendingProgress } from './analysisProgress';
import { saveFinishedReading } from './finishedReadings';
import { keptCapture } from './keptCapture';
import { DEFAULT_MODE } from './mode';

export type AnalysisState =
  | { phase: 'unavailable' }
  | { phase: 'running'; progress: AnalysisProgress }
  | { phase: 'done'; progress: AnalysisProgress; readingId: string }
  | { phase: 'failed'; progress: AnalysisProgress; reason: string };

// The Processing route always passes what pre-check recorded; this is only for a caller that has none.
const DEFAULT_REQUEST: AnalysisRequest = { mode: DEFAULT_MODE, restTimerDone: false };

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
    let latest = pendingProgress;
    analyzeKeptCapture(capture, { mode, restTimerDone }, (progress) => {
      latest = progress;
      if (active) setState({ phase: 'running', progress });
    }).then(
      ({ readingId, reading, recordedMs, progress }) => {
        saveFinishedReading({
          id: readingId,
          mode,
          createdAt: new Date(recordedMs),
          synthetic: false,
          scan: reading,
          intervalsMs: [],
          repeat: null,
          diabetesDays: [],
        });
        if (active) setState({ phase: 'done', progress, readingId });
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Reading analysis failed: ${reason}`);
        if (active)
          setState({
            phase: 'failed',
            progress: latest,
            reason,
          });
      },
    );
    return () => {
      active = false;
    };
  }, [capture, mode, restTimerDone]);

  return state;
}
