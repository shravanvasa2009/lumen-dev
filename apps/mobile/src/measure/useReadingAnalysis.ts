import type { AnalysisProgress } from './analysisProgress';

export type AnalysisState =
  | { phase: 'unavailable' }
  | { phase: 'running'; progress: AnalysisProgress }
  | { phase: 'done'; progress: AnalysisProgress; readingId: string };

// The place where the Processing screen gets its steps. analyzeReading and the ML runtime (ADR 0041,
// ADR 0050) are not on main, so nothing can be analysed and this always reports unavailable rather than
// inventing progress. Once they land, it runs them here and reports each step as it ends.
export function useReadingAnalysis(): AnalysisState {
  return { phase: 'unavailable' };
}
