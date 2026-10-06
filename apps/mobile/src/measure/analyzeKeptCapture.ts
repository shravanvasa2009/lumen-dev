import {
  analyzeReading,
  buildReadingResult,
  type DiabetesOutputs,
  diabetesModelInput,
  isProbabilityRow,
  logisticRhythmOutputs,
  readingOutcome,
  type InconclusiveOutcome,
  type ModelOutputs,
  type Profile,
  type ReadingAnalysis,
  type ReadingContext,
  type ReadingResult,
  readingRhythm,
  rhythmModelRows,
  type RhythmOutputs,
  type UrgentHeartRate,
} from '@lumen/core';

import evidence from '../../assets/evidence.json';
import { classifyRhythm, rhythmRuleEntry, scoreDiabetesInput } from '../ml/runtime';
import { storedReadingTier } from '../store/deviceRating';
import { loadProfile } from '../store/profile';
import { pastReadings } from '../store/readings';
import { type AnalysisProgress, type CheckOutputs, pendingProgress } from './analysisProgress';
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
  // ADR 0076: the emergency heart-rate rules ran on this capture; Processing routes on it, never on the model.
  urgent: UrgentHeartRate | null;
};

// One turn of the event loop, so the screen draws a step as active before the next blocking step starts.
const letScreenDraw = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function localDay(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// §11.1 basic analysis: when the model is missing or fails on any row, the rhythm-logistic rule scores every
// row, so one reading is never judged by a mix of two scorers. No rule entry leaves the reading without a
// rhythm output.
function ruleRhythmOutputs(analysis: ReadingAnalysis): RhythmOutputs | null {
  const entry = rhythmRuleEntry();
  if (entry === null) return null;
  try {
    return { ...logisticRhythmOutputs(entry, rhythmModelRows(analysis)), scorer: 'rule' };
  } catch (error) {
    // A RangeError is a window the rule cannot score; any other error is a broken manifest or a bug.
    if (!(error instanceof RangeError)) throw error;
    console.warn(`the basic-analysis rule could not score this reading: ${error.message}`);
    return null;
  }
}

// The rows are the DSP-15 windows, or one reading-wide row on a short reading (ADR 0104).
async function rhythmOutputs(analysis: ReadingAnalysis): Promise<RhythmOutputs | null> {
  const rows = rhythmModelRows(analysis);
  if (rows.length === 0) return null;
  const windowProbs: [number, number, number][] = [];
  let tauAf: number | null = null;
  for (const features of rows) {
    const outcome = await classifyRhythm({
      features: { values: Float32Array.from(features), dims: [1, features.length] },
    });
    if (outcome.source !== 'model') return ruleRhythmOutputs(analysis);
    const { sinus, af, other } = outcome.scores;
    const cut = outcome.threshold.af;
    if (sinus === undefined || af === undefined || other === undefined || typeof cut !== 'number')
      throw new Error('the rhythm model must score sinus, af and other and give an af threshold');
    if (!isProbabilityRow([sinus, af, other])) {
      console.warn('rhythm model returned a row that is not a probability row; using basic analysis');
      return ruleRhythmOutputs(analysis);
    }
    windowProbs.push([sinus, af, other]);
    tauAf = cut;
  }
  return tauAf === null ? null : { windowProbs, tauAf, scorer: 'model' };
}

// A Full Scan, and a Quick Check as a lower-quality one (owner, ADR 0104), can show a diabetes card. No
// averaged beat, or no model, leaves the reading without one; buildReadingResult decides how it is tagged.
async function diabetesOutputs(
  analysis: ReadingAnalysis,
  rhythm: RhythmOutputs | null,
  profile: Profile,
): Promise<DiabetesOutputs | null> {
  if (analysis.context.mode !== 'full' && analysis.context.mode !== 'quick') return null;
  const input = diabetesModelInput(analysis, readingRhythm(analysis, rhythm, profile));
  if (input === null) return null;
  const outcome = await scoreDiabetesInput(input);
  if (outcome.source !== 'model') return null;
  const { pattern } = outcome.scores;
  const cut = outcome.threshold.pattern;
  if (pattern === undefined || typeof cut !== 'number') {
    console.warn('the diabetes model gave no pattern score or threshold; the reading has no diabetes check');
    return null;
  }
  return { probability: pattern, tauDm: cut };
}

const step = (
  steps: Partial<AnalysisProgress['steps']>,
  counts: Pick<AnalysisProgress, 'beats' | 'rejectedBeats'>,
  outputs: CheckOutputs | null = null,
): AnalysisProgress => ({ steps: { ...pendingProgress.steps, ...steps }, ...counts, outputs });

// ADR 0041 / 0050: analyzeReading, then the rhythm model, then the decision rules and evidence labels.
// Each step is reported when the work behind it has finished; breathing is computed inside analyzeReading,
// so it completes with the beats.
export async function analyzeKeptCapture(
  capture: KeptCapture,
  request: AnalysisRequest,
  report: (progress: AnalysisProgress) => void,
  reportUrgent: (urgent: UrgentHeartRate | null) => void,
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
  const analysis = analyzeReading({ samples: capture.samples, stats: capture.stats }, context);
  // Spec 07: too little clean signal is not a reading, so nothing past this point runs for it.
  const outcome = readingOutcome(analysis);
  // Before any step that can throw (profile, model, save): a later failure must not hide an emergency.
  reportUrgent(outcome.urgent);
  if (outcome.kind === 'inconclusive') return outcome;
  const detected = analysis.segments.flat().filter((beat) => beat.beatClass !== 'not-a-beat');
  const counts = {
    beats: detected.length,
    rejectedBeats: detected.filter((beat) => beat.beatClass === 'artifact').length,
  };

  report(step({ beats: 'done', breathing: 'done', rhythm: 'active' }, counts));
  await letScreenDraw();
  const [profile, history] = await Promise.all([loadProfile(), pastReadings()]);
  const rhythm = await rhythmOutputs(analysis);
  const models: ModelOutputs = { rhythm, diabetes: await diabetesOutputs(analysis, rhythm, profile) };

  report(step({ beats: 'done', breathing: 'done', rhythm: 'done', baseline: 'active' }, counts));
  await letScreenDraw();
  const reading = buildReadingResult(analysis, models, evidence, profile, history);

  const { rhythm: rhythmMetric, rmssd, diabetes } = reading.metrics;
  const finished = step({ beats: 'done', breathing: 'done', rhythm: 'done', baseline: 'done' }, counts, {
    afib: rhythmMetric !== null,
    hrv: rmssd !== null,
    diabetes: diabetes !== null,
  });
  return {
    readingId: `reading-${recordedMs}`,
    recordedMs,
    context,
    models,
    reading,
    progress: finished,
    urgent: outcome.urgent,
  };
}
