import {
  analyzeReading,
  buildReadingResult,
  readingOutcome,
  type InconclusiveOutcome,
  type ModelOutputs,
  type ReadingAnalysis,
  type ReadingContext,
  type ReadingResult,
  type RhythmOutputs,
} from '@lumen/core';

import evidence from '../../assets/evidence.json';
import { classifyRhythm } from '../ml/runtime';
import { storedReadingTier } from '../store/deviceRating';
import { loadProfile } from '../store/profile';
import { type AnalysisProgress, pendingProgress } from './analysisProgress';
import type { KeptCapture } from './keptCapture';
import type { MeasureMode } from './mode';

export type AnalysisRequest = { mode: MeasureMode; restTimerDone: boolean };

export type AnalysedReading = {
  readingId: string;
  recordedMs: number;
  context: ReadingContext;
  models: ModelOutputs;
  reading: ReadingResult;
  progress: AnalysisProgress;
};

// One turn of the event loop, so the screen draws a step as active before the next blocking step starts.
const letScreenDraw = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function localDay(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Basic analysis for any window (no model, or the model failed that run) leaves the whole reading without a
// rhythm output: a rhythm card built from some windows' scores would judge a reading nobody fully scored.
async function rhythmOutputs(analysis: ReadingAnalysis): Promise<RhythmOutputs | null> {
  if (analysis.rhythmFeatures.length === 0) return null;
  const windowProbs: [number, number, number][] = [];
  let tauAf: number | null = null;
  for (const features of analysis.rhythmFeatures) {
    const outcome = await classifyRhythm({
      features: { values: Float32Array.from(features), dims: [1, features.length] },
    });
    if (outcome.source !== 'model') return null;
    const { sinus, af, other } = outcome.scores;
    const cut = outcome.threshold.af;
    if (sinus === undefined || af === undefined || other === undefined || typeof cut !== 'number')
      throw new Error('the rhythm model must score sinus, af and other and give an af threshold');
    windowProbs.push([sinus, af, other]);
    tauAf = cut;
  }
  return tauAf === null ? null : { windowProbs, tauAf };
}

const step = (
  steps: Partial<AnalysisProgress['steps']>,
  counts: Pick<AnalysisProgress, 'beats' | 'rejectedBeats'>,
): AnalysisProgress => ({ steps: { ...pendingProgress.steps, ...steps }, ...counts });

// ADR 0041 / 0050: analyzeReading, then the rhythm model, then the decision rules and evidence labels.
// Each step is reported when the work behind it has finished; breathing is computed inside analyzeReading,
// so it completes with the beats.
export async function analyzeKeptCapture(
  capture: KeptCapture,
  request: AnalysisRequest,
  report: (progress: AnalysisProgress) => void,
): Promise<AnalysedReading | InconclusiveOutcome> {
  const recordedMs = Date.now();
  const context: ReadingContext = {
    captureFps: capture.captureFps,
    tier: await storedReadingTier(),
    mode: request.mode,
    restTimerDone: request.restTimerDone,
    recordedAt: { ms: recordedMs, day: localDay(recordedMs) },
    motionSpans: capture.motionSpans,
    coldHandsSpans: capture.coldHandsSpans,
    sqi: capture.sqi,
    validationRhythmLabel: null,
  };
  const noCounts = { beats: null, rejectedBeats: null };

  report(step({ beats: 'active' }, noCounts));
  await letScreenDraw();
  // The capture screen may still be appending frames, so the analysis works on a snapshot.
  const analysis = analyzeReading({ samples: [...capture.samples], stats: [...capture.stats] }, context);
  // Spec 07: too little clean signal is not a reading, so nothing past this point runs for it.
  const outcome = readingOutcome(analysis);
  if (outcome.kind === 'inconclusive') return outcome;
  const detected = analysis.segments.flat().filter((beat) => beat.beatClass !== 'not-a-beat');
  const counts = {
    beats: detected.length,
    rejectedBeats: detected.filter((beat) => beat.beatClass === 'artifact').length,
  };

  report(step({ beats: 'done', breathing: 'done', rhythm: 'active' }, counts));
  await letScreenDraw();
  const models: ModelOutputs = { rhythm: await rhythmOutputs(analysis), diabetes: null };

  report(step({ beats: 'done', breathing: 'done', rhythm: 'done', baseline: 'active' }, counts));
  await letScreenDraw();
  const profile = await loadProfile();
  const reading = buildReadingResult(analysis, models, evidence, profile, []);

  const finished = step({ beats: 'done', breathing: 'done', rhythm: 'done', baseline: 'done' }, counts);
  return { readingId: `reading-${recordedMs}`, recordedMs, context, models, reading, progress: finished };
}
