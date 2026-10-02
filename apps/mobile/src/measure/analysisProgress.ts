export type AnalysisStepId = 'beats' | 'rhythm' | 'breathing' | 'baseline';
export type StepState = 'done' | 'active' | 'pending';

// What the analysis reports about itself: the state of each step, and the beat counts once the beats
// are cleaned. The counts are null until then; nothing here is estimated.
export type AnalysisProgress = {
  steps: Record<AnalysisStepId, StepState>;
  beats: number | null;
  rejectedBeats: number | null;
};

export const STEP_ORDER: readonly AnalysisStepId[] = ['beats', 'rhythm', 'breathing', 'baseline'];

export const pendingProgress: AnalysisProgress = {
  steps: { beats: 'pending', rhythm: 'pending', breathing: 'pending', baseline: 'pending' },
  beats: null,
  rejectedBeats: null,
};

// The ring shows how many of the steps have finished, so it only moves when the analysis does.
export function completedPercent(progress: AnalysisProgress): number {
  const done = STEP_ORDER.filter((step) => progress.steps[step] === 'done').length;
  return Math.round((100 * done) / STEP_ORDER.length);
}
