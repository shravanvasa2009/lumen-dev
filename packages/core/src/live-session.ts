import type { CaptureStatus, FrameStat, Sample, SampleBatch } from './capture';
import type { NsSpan, SqiScores } from './reading';

// DSP-9. Never assigned from interval irregularity alone.
export type BeatClass = 'not-a-beat' | 'artifact' | 'atypical' | 'normal';

// Times are seconds from capture start (DSP-1).
export interface ClassifiedBeat {
  peakS: number;
  // DSP-8; null when nothing rises before the peak. Its upslope is then 0, so it is not a beat unless the
  // segment's median upslope is 0 too.
  onsetS: number | null;
  beatClass: BeatClass;
  longPause: boolean; // DSP-9 long pause on the interval ending at this beat: kept for rhythm, not HRV
}

// Appendix C coach.* strings; the coaching state machine shows one at a time (§7).
export type CoachingKey = 'coach.cover' | 'coach.lighter' | 'coach.still' | 'coach.warm' | 'coach.flat';

// DSP-9 acquisition causes; quality = SQI-rejected window, exposure = the 1 s after a change (DSP-5).
export type RejectionReason =
  'motion' | 'pressure' | 'coverage' | 'coldHands' | 'quality' | 'clipping' | 'exposure';

// Greyed out and labeled on the live waveform (§12).
export interface RejectedSpan {
  startS: number;
  endS: number;
  reason: RejectionReason;
}

// SQI-Net v1 input (ADR 0023, [1, 256]): one channel, −R, 4 s at 64 Hz = 256 samples, z-scored (DSP-3).
export interface SqiWindow {
  endS: number;
  input: Float32Array;
}

// Fed by the app's CaptureController (§9.3 step 3).
export interface LiveSession {
  pushSamples(batch: SampleBatch): void;
  pushStatus(status: CaptureStatus): void;
  // SQI-Net runs in the app every 1 s on the last 4 s window (§11.2). Pass sqiWindow.endS unchanged. Its score
  // is advisory (owner 2026-10-06): a low one tags the reading and rejects nothing. A RangeError for an end outside the reading or not a whole ns (readingInput could not hand it on
  // exactly), or a pClean outside [0, 1].
  setSqi(windowEndS: number, pClean: number): void;
  readonly cleanSeconds: number;
  // Live perfusion index in % over the last live.perfusionWindowS of covered, gap-free frames (the cold-hands
  // check's window); null until such a window exists. For the practice meter (couplingFactor).
  readonly perfusionPct: number | null;
  readonly recentWaveform: { tS: number[]; ppg: number[] }; // last 6 s
  readonly coachingKey: CoachingKey | null;
  readonly rejectedSpans: RejectedSpan[];
  readonly sqiWindow: SqiWindow | null; // null until 4 s of covered signal exists
  // H-025: everything analyzeReading needs from the session, so the saved result matches the live screen.
  // Spans still open are closed at the newest frame. sqi is null until the first setSqi.
  readingInput(): {
    capture: { samples: Sample[]; stats: FrameStat[] };
    motionSpans: NsSpan[];
    coldHandsSpans: NsSpan[];
    sqi: SqiScores | null;
  };
}
