import { DSP_CONFIG } from './config';
import { median } from './median';
import type { ReadingAnalysis, Tier } from './reading';
import { hrv } from './reading-metrics';
import type {
  Confidence,
  DiabetesMetric,
  EvidenceLabel,
  HeadlineKey,
  HrFlag,
  HrMetric,
  ReadingResult,
  ReadingRhythm,
  RespMetric,
  RhythmClass,
  RhythmMetric,
  RmssdMetric,
} from './results';

// Rhythm model output per DSP-15 window, in the manifest's label order: sinus, af, other.
export interface RhythmOutputs {
  windowProbs: [number, number, number][];
  tauAf: number; // the manifest threshold for reading-level P(AF)
}
export interface DiabetesOutputs {
  probability: number;
  tauDm: number;
}
// Models run in the app (or replay), never in core; null when a model did not run.
export interface ModelOutputs {
  rhythm: RhythmOutputs | null;
  diabetes: DiabetesOutputs | null;
}

// docs/validation/evidence.json (Appendix B); only label and passed are read.
export interface EvidenceFile {
  metrics: Record<string, { label: string; passed?: boolean } | undefined>;
}

export interface Profile {
  athlete: boolean;
  betaBlocker: boolean;
  pacemaker: boolean; // turns rhythm screening off (§6 notes)
  knownAf: boolean; // "rhythm tracking": no rhythm flags
}

// What earlier saved readings contribute to the history rules.
export interface PastReading {
  atMs: number;
  rhythmPositive: boolean; // that reading's irregular rule fired
  rmssdMs: number | null;
  diabetes: { day: string; probability: number; confidence: Confidence } | null;
}

export const RHYTHM_CLASSES: readonly RhythmClass[] = ['sinus', 'af', 'other'];
const LEVELS: Confidence[] = ['low', 'moderate', 'high'];
const lowest = (...levels: Confidence[]): Confidence =>
  LEVELS[Math.min(...levels.map((level) => LEVELS.indexOf(level)))]!;

// EVID-1 and ADR 0022: a label only when evidence.json states it and passed is true.
function evidenceLabel(evidence: EvidenceFile, metric: string): EvidenceLabel {
  const entry = evidence.metrics[metric];
  if (entry?.passed !== true) return 'experimental';
  return entry.label === 'checked' || entry.label === 'public-data' ? entry.label : 'experimental';
}

// §6.2 minimum rating. An unrated phone is judged by its frame rate alone (§5.2's fps conditions).
function tierAtLeast(analysis: ReadingAnalysis, needed: Tier): boolean {
  const { tier, captureFps } = analysis.context;
  const effective: Tier = tier ?? (captureFps >= 60 ? 'full' : captureFps >= 30 ? 'basic' : 'limited');
  const order: Tier[] = ['limited', 'basic', 'full'];
  return order.indexOf(effective) >= order.indexOf(needed);
}

// §7: clean coverage, capped at moderate without SQI scores and on a Limited or unrated phone.
function readingConfidence(analysis: ReadingAnalysis): Confidence {
  const { highCoverage, moderateCoverage } = DSP_CONFIG.confidence;
  const coverage = analysis.durationS > 0 ? analysis.cleanSeconds / analysis.durationS : 0;
  const fromCoverage: Confidence =
    coverage >= highCoverage ? 'high' : coverage >= moderateCoverage ? 'moderate' : 'low';
  const { tier } = analysis.context;
  const capped = !analysis.sqiAvailable || tier === null || tier === 'limited';
  return capped ? lowest(fromCoverage, 'moderate') : fromCoverage;
}

function hrFlag(
  analysis: ReadingAnalysis,
  bpm: number,
  profile: Profile,
  confidence: Confidence,
): HrFlag | null {
  const rules = DSP_CONFIG.rules;
  if (
    confidence === 'low' ||
    !analysis.context.restTimerDone ||
    analysis.cleanSeconds < rules.restingMinCleanS
  )
    return null;
  const [fastRegularLow, fastRegularHigh] = rules.fastRegularBpm as [number, number];
  const veryRegular =
    analysis.normalizedRmssd !== null && analysis.normalizedRmssd < rules.fastRegularMaxNormalizedRmssd;
  if (bpm >= fastRegularLow && bpm <= fastRegularHigh && veryRegular) return 'fastRegular';
  if (bpm > rules.fastRestingBpm) return 'fastResting';
  const slowBelow =
    profile.athlete || profile.betaBlocker ? rules.slowRestingAdjustedBpm : rules.slowRestingBpm;
  return bpm < slowBelow ? 'slowResting' : null;
}

interface RhythmCall {
  metric: RhythmMetric;
  topProb: number;
  positive: boolean; // the irregular rule fired (before the 2-of-3 rule)
}

/** A rhythm row buildReadingResult accepts: one finite probability per class, summing to 1. */
export function isProbabilityRow(row: readonly number[]): boolean {
  if (row.length !== RHYTHM_CLASSES.length) return false;
  let total = 0;
  for (let c = 0; c < row.length; c++) {
    const probability = row[c];
    if (typeof probability !== 'number' || !(probability >= 0 && probability <= 1)) return false;
    total += probability;
  }
  return Math.abs(total - 1) <= DSP_CONFIG.rules.rhythmRowSumTolerance;
}

// Reading-level probabilities in RHYTHM_CLASSES order (the mean over windows); null when the reading gets
// no rhythm card.
function readingRhythmProbs(
  analysis: ReadingAnalysis,
  outputs: RhythmOutputs | null,
  profile: Profile,
): number[] | null {
  const rules = DSP_CONFIG.rules;
  const windows = analysis.rhythmWindows.length;
  if (outputs && outputs.windowProbs.length !== windows)
    throw new RangeError(`${windows} rhythm windows but ${outputs.windowProbs.length} probability rows`);
  // Like a wrong row count, a row that is not a probability distribution means the model or rule
  // misbehaved; a NaN here once reached the card as a class-less "irregular, retake".
  if (outputs && !outputs.windowProbs.every(isProbabilityRow))
    throw new RangeError('each rhythm window needs sinus, af, other probabilities that sum to 1');
  if (!outputs || profile.pacemaker || windows === 0) return null;
  if (analysis.cleanSeconds < rules.rhythmMinCleanS || !analysis.enoughRhythmIntervals) return null;

  return RHYTHM_CLASSES.map((_, c) => {
    let total = 0;
    for (const row of outputs.windowProbs) total += row[c]!;
    return total / windows;
  });
}

// The class with the highest probability, the first in RHYTHM_CLASSES order on a tie.
const topClass = (probs: number[]) => probs.indexOf(Math.max(...probs));

// With no rhythm model output it is the replay validation label (ADR 0041), null in the app.
/** The rhythm decision that opens DSP-12 and diabetes-net's hrSummary; null with no rhythm card. */
export function readingRhythm(
  analysis: ReadingAnalysis,
  outputs: RhythmOutputs | null,
  profile: Profile,
): ReadingRhythm | null {
  // Validation only (ADR 0041): with no rhythm model output, a labelled rhythm stands in.
  if (outputs === null) return analysis.context.validationRhythmLabel;
  const probs = readingRhythmProbs(analysis, outputs, profile);
  if (!probs) return null;
  const top = topClass(probs);
  return probs[top]! >= DSP_CONFIG.rules.uncertainBelowTopProb ? RHYTHM_CLASSES[top]! : 'uncertain';
}

function rhythmCall(
  analysis: ReadingAnalysis,
  outputs: RhythmOutputs | null,
  evidence: EvidenceFile,
  profile: Profile,
  history: PastReading[],
  confidence: Confidence,
): RhythmCall | null {
  const rules = DSP_CONFIG.rules;
  const probs = readingRhythmProbs(analysis, outputs, profile);
  if (!outputs || !probs) return null;
  const top = topClass(probs);
  const topProb = probs[top]!;
  const fromProb: Confidence =
    topProb >= DSP_CONFIG.confidence.highTopProb
      ? 'high'
      : topProb >= rules.uncertainBelowTopProb
        ? 'moderate'
        : 'low';
  const cardConfidence = lowest(confidence, fromProb);
  const pAF = probs[1]!;
  const positive =
    topProb >= rules.uncertainBelowTopProb && pAF >= outputs.tauAf && cardConfidence === 'high';

  let flag: RhythmMetric['flag'] = null;
  if (positive && !profile.knownAf) {
    flag = 'irregular';
    const now = analysis.context.recordedAt?.ms;
    if (now !== undefined) {
      const recent = history
        .filter((past) => past.atMs < now && now - past.atMs <= rules.possibleAfWindowHours * 3_600_000)
        .sort((x, y) => y.atMs - x.atMs)
        .slice(0, rules.possibleAfReadings - 1);
      if (1 + recent.filter((past) => past.rhythmPositive).length >= rules.possibleAfPositives)
        flag = 'possibleAf';
    }
  }
  return {
    metric: {
      class: RHYTHM_CLASSES[top]!,
      pAF,
      evidence: evidenceLabel(evidence, 'rhythm'),
      confidence: cardConfidence,
      flag,
    },
    topProb,
    positive,
  };
}

// Quartile by linear interpolation between order statistics (numpy's default percentile).
function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below]! + (position - below) * (sorted[above]! - sorted[below]!);
}

// §7 personal band: median ± 1.5 IQR of earlier values, after the 7 "learning" readings.
function personalBand(values: number[]): [number, number] | null {
  const { personalBandMinReadings, personalBandIqrs } = DSP_CONFIG.rules;
  if (values.length < personalBandMinReadings) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const middle = median(sorted);
  return [middle - personalBandIqrs * iqr, middle + personalBandIqrs * iqr];
}

function diabetesMetric(
  analysis: ReadingAnalysis,
  outputs: DiabetesOutputs | null,
  evidence: EvidenceFile,
  history: PastReading[],
  confidence: Confidence,
): DiabetesMetric | null {
  const rules = DSP_CONFIG.rules;
  const { mode, recordedAt } = analysis.context;
  if (
    !outputs ||
    mode !== 'full' ||
    !tierAtLeast(analysis, 'full') ||
    analysis.cleanSeconds < rules.diabetesMinCleanS
  )
    return null;
  const earlier = history.flatMap((past) => (past.diabetes ? [past.diabetes] : []));
  const readings = [
    { day: recordedAt?.day ?? null, probability: outputs.probability, confidence },
    ...earlier,
  ];
  let total = 0;
  for (const reading of readings) total += reading.probability;
  const probability = total / readings.length;
  const days = new Set(readings.map((reading) => reading.day).filter((day) => day !== null));
  const label = evidenceLabel(evidence, 'diabetes');
  // §11.4: flaggable only when ML-6 is met, which evidence.json records as public-data with passed true.
  const flagged =
    label === 'public-data' &&
    days.size >= rules.diabetesMinReadings &&
    readings.every((reading) => reading.confidence !== 'low') &&
    probability >= outputs.tauDm;
  return {
    probability,
    readingsUsed: readings.length,
    evidence: label,
    confidence,
    flag: flagged ? 'pattern' : null,
  };
}

function headline(hr: HrMetric | null, rhythm: RhythmCall | null): HeadlineKey {
  if (!hr) return 'result.inconclusive';
  if (rhythm?.metric.flag === 'possibleAf') return 'result.possibleAf';
  if (rhythm?.metric.flag === 'irregular') return 'result.irregularRetake';
  // No rhythm card means the rhythm was not judged; "Regular rhythm" would claim it was (ADR 0041).
  if (!rhythm || rhythm.topProb < DSP_CONFIG.rules.uncertainBelowTopProb) return 'result.uncertain';
  return rhythm.metric.class === 'sinus' ? 'result.regular' : 'result.irregularRetake';
}

// Evidence labels come from evidence.json only (EVID-1).
/** Appendix B Results JSON for one reading: §10.1 rules, §6.2 floors, and §7 confidence. */
export function buildReadingResult(
  analysis: ReadingAnalysis,
  models: ModelOutputs,
  evidence: EvidenceFile,
  profile: Profile,
  history: PastReading[],
): ReadingResult {
  const confidence = readingConfidence(analysis);
  const hr: HrMetric | null =
    analysis.heartRateBpm === null
      ? null
      : {
          value: analysis.heartRateBpm,
          unit: 'bpm',
          evidence: evidenceLabel(evidence, 'hr'),
          confidence,
          flag: hrFlag(analysis, analysis.heartRateBpm, profile, confidence),
        };
  const rhythm = rhythmCall(analysis, models.rhythm, evidence, profile, history, confidence);

  let rmssd: RmssdMetric | null = null;
  if (readingRhythm(analysis, models.rhythm, profile) === 'sinus' && tierAtLeast(analysis, 'full')) {
    const values = hrv(analysis.segments, 'sinus', analysis.context.captureFps, analysis.cleanSeconds);
    if (values?.rmssdMs != null) {
      const earlier = history.flatMap((past) => (past.rmssdMs === null ? [] : [past.rmssdMs]));
      rmssd = {
        value: values.rmssdMs,
        unit: 'ms',
        band: personalBand(earlier),
        evidence: evidenceLabel(evidence, 'hrv'),
        confidence,
      };
    }
  }

  const breathing = analysis.breathing?.rateBrpm ?? null;
  const resp: RespMetric | null =
    breathing !== null && tierAtLeast(analysis, 'basic')
      ? { value: breathing, unit: 'br/min', evidence: evidenceLabel(evidence, 'resp'), confidence }
      : null;

  const beats = analysis.segments.flat().filter((beat) => beat.beatClass !== 'not-a-beat');
  const atypical = beats.filter((beat) => beat.beatClass === 'atypical').length;
  const normal = beats.filter((beat) => beat.beatClass === 'normal').length;
  return {
    headlineKey: headline(hr, rhythm),
    cleanSeconds: analysis.cleanSeconds,
    beats: beats.length,
    rejectedBeats: beats.filter((beat) => beat.beatClass === 'artifact').length,
    metrics: {
      hr,
      rhythm: rhythm?.metric ?? null,
      rmssd,
      resp,
      diabetes: diabetesMetric(analysis, models.diabetes, evidence, history, confidence),
    },
    experimental: {
      extraBeatsPerMin: analysis.cleanSeconds > 0 ? atypical / (analysis.cleanSeconds / 60) : 0,
      longPauses: beats.filter((beat) => beat.longPause).length,
      pulseShape: {
        available:
          analysis.context.captureFps >= DSP_CONFIG.rules.pulseShapeMinFps &&
          normal >= DSP_CONFIG.rules.pulseShapeMinNormalBeats,
      },
    },
    lostSeconds: analysis.lostSeconds,
    notChecked: ['bp', 'spo2', 'heartAttack'],
  };
}
