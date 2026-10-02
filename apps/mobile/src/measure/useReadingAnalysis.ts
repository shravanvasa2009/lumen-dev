import type { AnalysisProgress } from './analysisProgress';
import type { MeasureMode } from './mode';

export type ReadingParams = {
  mode: MeasureMode;
  restDone: string | undefined;
  context: string | undefined;
};

export type ReadingAnalysis =
  // analyzeReading and the ML runtime are not in the app yet (ADR 0041, ADR 0050), so nothing can be analysed.
  | { phase: 'unavailable' }
  | { phase: 'running'; progress: AnalysisProgress }
  | { phase: 'done'; progress: AnalysisProgress; readingId: string };

// Will run analyzeReading and the rhythm model on the finished capture and report each step as it ends.
export function useReadingAnalysis(_params: ReadingParams): ReadingAnalysis {
  return { phase: 'unavailable' };
}
