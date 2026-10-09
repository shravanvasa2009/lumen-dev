import type { Tier } from './reading';

// Results JSON for one reading (Appendix B). A metric is null when its card missed the clean-data
// floor in §6.2 or its gate in §10.1; that card alone shows "Not enough clean signal" (§7).

// §6.1; comes only from evidence.json.
export type EvidenceLabel = 'checked' | 'public-data' | 'experimental';
// About this one reading (§7); low-confidence results are never flags.
export type Confidence = 'high' | 'moderate' | 'low';
// Rhythm-Net classes (§11).
export type RhythmClass = 'sinus' | 'af' | 'other';
// The reading's rhythm decision: a Rhythm-Net class, or 'uncertain' when its top probability is under
// rules.uncertainBelowTopProb.
export type ReadingRhythm = RhythmClass | 'uncertain';
// Appendix C result.* strings that headline a reading.
export type HeadlineKey =
  | 'result.regular'
  | 'result.irregularRetake'
  | 'result.possibleAf'
  | 'result.inconclusive'
  | 'result.uncertain'
  | 'result.hrOnly';
// §6.4, listed under result.notChecked.
export type NotChecked = 'bp' | 'spo2' | 'heartAttack';

// Why a result is tagged lower quality (owner 2026-10-05, ADR 0104): each names a standard floor that failed.
export type QualityReason =
  | { kind: 'shortClean'; haveS: number; wantS: number }
  | { kind: 'lowFps'; fps: number; wantFps: number }
  | { kind: 'noSqi' }
  | { kind: 'modelFallback' }
  // The diabetes pattern's Full Scan floor (§11.4). Before owner answer 4 (2026-10-06) it tagged every Quick value.
  | { kind: 'quickMode' }
  | { kind: 'contact'; coveredPct: number }
  | { kind: 'fewBeats'; beats: number; wantBeats: number }
  | { kind: 'fewWindows'; windows: number; wantWindows: number }
  // DSP-13's three breathing estimates were all found but disagreed, so the interval estimate alone is shown.
  | { kind: 'estimatesDisagree' }
  // §5.2: the phone's rating, not its frame rate, is below the tier the output needs.
  | { kind: 'phoneTier'; tier: Tier; wantTier: Tier }
  // No rhythm model or rule judged the rhythm, so RMSSD was computed without checking it is sinus (DSP-12).
  | { kind: 'rhythmUnjudged' }
  // SQI-Net scored `windows` of its `total` windows under its threshold. Advisory (owner 2026-10-06): those
  // seconds still count as clean, and this reason alone caps confidence at moderate instead of low.
  | { kind: 'sqiFlagged'; windows: number; total: number }
  // SQI-Net ran but no scored window covers `seconds` clean seconds, as when it stops partway (owner 2026-10-09).
  | { kind: 'sqiUnscored'; seconds: number };
// 'low': a standard floor failed and the same math ran on the beats there were.
export type MetricQuality = 'standard' | 'low';
// 'low' when any metric is; reasons are the union over the metrics, one per kind.
export interface ReadingQuality {
  level: MetricQuality;
  reasons: QualityReason[];
}
interface MetricQualityFields {
  quality: MetricQuality;
  qualityReasons: QualityReason['kind'][];
  // This metric's own reasons with its own floors (a heart rate's 15 s, not the diabetes pattern's 90 s).
  qualityDetails: QualityReason[];
}

// §10.1 slow/fast resting rate and fast regular rhythm. Fast regular rhythm needs only 30 clean s, so it
// lives on the HR card (15 s floor), not the rhythm card (60 s floor, §6.2).
// fastRegular wins over fastResting when both rules hold: it carries the "seek care" message (§6.2).
export type HrFlag = 'slowResting' | 'fastResting' | 'fastRegular';
// §10.1 irregular rhythm (one reading) and possible AFib (2 of 3 readings within 24 h).
export type RhythmFlag = 'irregular' | 'possibleAf';
// §10.1; only when ML-6 is met, otherwise the metric is labeled experimental and carries no flag.
export type DiabetesFlag = 'pattern';

// DSP-11.
export interface HrMetric extends MetricQualityFields {
  value: number;
  unit: 'bpm';
  evidence: EvidenceLabel;
  confidence: Confidence;
  flag: HrFlag | null;
}
// §11.10: the rhythm model, or the logistic rule ("basic analysis") when the model could not run.
export type RhythmScorer = 'model' | 'rule';
// §11, DSP-15. class and pAF are null when a reading-wide window was too short to judge (ADR 0104 answer 5).
export interface RhythmMetric extends MetricQualityFields {
  class: RhythmClass | null;
  pAF: number | null;
  evidence: EvidenceLabel;
  scorer?: RhythmScorer; // absent in readings saved before the rule fallback: those were model-scored
  confidence: Confidence;
  flag: RhythmFlag | null;
}
// DSP-12; never flagged.
export interface RmssdMetric extends MetricQualityFields {
  value: number;
  unit: 'ms';
  band: [number, number] | null; // personal band, null for the first 7 "learning" readings (§7)
  evidence: EvidenceLabel;
  confidence: Confidence;
}
// DSP-13.
export interface RespMetric extends MetricQualityFields {
  value: number;
  unit: 'br/min';
  evidence: EvidenceLabel;
  confidence: Confidence;
}
// §10.1, §11.4.
export interface DiabetesMetric extends MetricQualityFields {
  probability: number; // mean over readingsUsed Full Scans on different days
  readingsUsed: number;
  evidence: EvidenceLabel;
  confidence: Confidence;
  flag: DiabetesFlag | null;
}

// §6.3; never flagged.
export interface ExperimentalMeasurements extends MetricQualityFields {
  extraBeatsPerMin: number;
  longPauses: number;
  pulseShape: { available: boolean };
}
// For coaching and targeted lessons (§8).
export interface LostSeconds {
  motion: number;
  pressure: number;
  coverage: number;
  coldHands: number;
}

// A lower-quality heart rate under 40 or over 150 bpm: retake now, sitting still (owner 2026-10-06, ADR 0104
// answer 2). Not the Emergency screen: SAFE-1 reads only the standard analysis.
export type RetakePrompt = 'shortSlow' | 'shortFast';

export interface ReadingResult {
  headlineKey: HeadlineKey;
  quality: ReadingQuality;
  retakePrompt: RetakePrompt | null;
  cleanSeconds: number;
  beats: number;
  rejectedBeats: number;
  metrics: {
    hr: HrMetric | null;
    rhythm: RhythmMetric | null;
    rmssd: RmssdMetric | null;
    resp: RespMetric | null;
    diabetes: DiabetesMetric | null;
  };
  experimental: ExperimentalMeasurements;
  lostSeconds: LostSeconds;
  notChecked: NotChecked[];
}
