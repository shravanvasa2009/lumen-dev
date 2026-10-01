import type { CaptureStatus, SampleBatch } from './capture';
import type { LostSeconds, ReadingResult } from './results';

/** DSP-9 beat classes. Never assigned from interval irregularity alone. */
export type BeatClass = 'not-a-beat' | 'artifact' | 'atypical' | 'normal';

/** A detected beat with its DSP-9 class; times are seconds from capture start (DSP-1). */
export interface ClassifiedBeat {
  peakS: number;
  onsetS: number;
  beatClass: BeatClass;
  longPause: boolean; // DSP-9 long pause: kept for rhythm, excluded from HRV
}

/** Appendix C coach.* strings; the coaching state machine shows one at a time (§7). */
export type CoachingKey = 'coach.cover' | 'coach.lighter' | 'coach.still' | 'coach.warm' | 'coach.flat';

/** A greyed-out, labeled span on the live waveform (§12). */
export interface RejectedSpan {
  startS: number;
  endS: number;
  reason: keyof LostSeconds;
}

/** Ring buffers and live state for one capture, fed by the app's CaptureController (§9.3 step 3). */
export interface LiveSession {
  pushSamples(batch: SampleBatch): void;
  pushStatus(status: CaptureStatus): void;
  // SQI-Net runs in the app every 1 s on the last 4 s window (§11.2).
  setSqi(windowEndS: number, pClean: number): void;
  readonly cleanSeconds: number;
  readonly recentWaveform: { tS: number[]; ppg: number[] }; // last 6 s
  readonly coachingKey: CoachingKey | null;
  readonly rejectedSpans: RejectedSpan[];
}

/** Final analysis of a stopped session (§9.3 step 4). */
export type AnalyzeReading = (session: LiveSession) => ReadingResult;
