// Results JSON for one reading (Appendix B). A metric is null when its card missed the clean-data
// floor in §6.2 or its gate in §10.1; that card alone shows "Not enough clean signal" (§7).

/** What the team has shown about a method (§6.1); comes only from evidence.json. */
export type EvidenceLabel = 'checked' | 'public-data' | 'experimental';
/** How much this one reading can be trusted (§7); low-confidence results are never flags. */
export type Confidence = 'high' | 'moderate' | 'low';
/** Rhythm-Net classes (§11). */
export type RhythmClass = 'sinus' | 'af' | 'other';
/** Appendix C result.* strings that headline a reading. */
export type HeadlineKey =
  | 'result.regular'
  | 'result.irregularRetake'
  | 'result.possibleAf'
  | 'result.inconclusive'
  | 'result.uncertain';
/** Things Lumen never measures (§6.4), listed under result.notChecked. */
export type NotChecked = 'bp' | 'spo2' | 'heartAttack';

/** §10.1 "Slow resting rate" and "Fast resting rate". */
export type HrFlag = 'slowResting' | 'fastResting';
/** §10.1 "Irregular rhythm (one reading)", "Possible AFib" (2 of 3 in 24 h), "Fast regular rhythm". */
export type RhythmFlag = 'irregular' | 'possibleAf' | 'fastRegular';
/** §10.1 "Pattern linked to diabetes"; only when ML-6 is met, otherwise the metric is experimental. */
export type DiabetesFlag = 'pattern';

/** Heart rate card (DSP-11). */
export interface HrMetric {
  value: number;
  unit: 'bpm';
  evidence: EvidenceLabel;
  confidence: Confidence;
  flag: HrFlag | null;
}
/** Rhythm card (§11, DSP-15). */
export interface RhythmMetric {
  class: RhythmClass;
  pAF: number;
  evidence: EvidenceLabel;
  confidence: Confidence;
  flag: RhythmFlag | null;
}
/** HRV card (DSP-12); never flagged. */
export interface RmssdMetric {
  value: number;
  unit: 'ms';
  band: [number, number] | null; // personal band, null for the first 7 "learning" readings (§7)
  evidence: EvidenceLabel;
  confidence: Confidence;
}
/** Breathing-rate card (DSP-13). */
export interface RespMetric {
  value: number;
  unit: 'br/min';
  evidence: EvidenceLabel;
  confidence: Confidence;
}
/** Diabetes-pattern card (§10.1, §11.4). */
export interface DiabetesMetric {
  probability: number; // mean over readingsUsed Full Scans on different days
  readingsUsed: number;
  evidence: EvidenceLabel;
  confidence: Confidence;
  flag: DiabetesFlag | null;
}

/** Experimental measurements (§6.3); never flagged. */
export interface ExperimentalMeasurements {
  extraBeatsPerMin: number;
  longPauses: number;
  pulseShape: { available: boolean };
}
/** Seconds lost per cause, for coaching and targeted lessons (§8). */
export interface LostSeconds {
  motion: number;
  pressure: number;
  coverage: number;
  coldHands: number;
}

/** The saved result of one reading (Appendix B). */
export interface ReadingResult {
  headlineKey: HeadlineKey;
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
