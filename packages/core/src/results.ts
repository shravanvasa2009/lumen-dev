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
  | { kind: 'quickMode' }
  | { kind: 'contact'; coveredPct: number }
  | { kind: 'fewBeats'; beats: number; wantBeats: number }
  | { kind: 'fewWindows'; windows: number; wantWindows: number };
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
// §11, DSP-15.
export interface RhythmMetric extends MetricQualityFields {
  class: RhythmClass;
  pAF: number;
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

export interface ReadingResult {
  headlineKey: HeadlineKey;
  quality: ReadingQuality;
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
