import { frameProblem } from '@lumen/core';
import { Platform } from 'react-native';

import {
  type CaptureStatus,
  type FrameStat,
  type LumenCaptureEvents,
  type RecordedCapture,
  ReplayCapture,
  type Sample,
} from '../../modules/lumen-capture/src';
import nitinAttempt1 from './recordings/nitin-attempt1.json';
import nitinScan from './recordings/nitin-scan.json';
import shravanAttempt1 from './recordings/shravan-attempt1.json';
import shravanScan from './recordings/shravan-scan.json';

// tools/showcase/recording.mjs writes these; `motion` holds the stretches, in seconds from the first frame,
// when the person moved. A Lab capture has no accelerometer stream, so the cue sheet's stretches stand in.
type ShowcaseRecording = RecordedCapture & {
  origin: string;
  motion: { fromS: number; toS: number }[];
};

// Well above live.motionRmsThreshold (0.05 g); tools/showcase/check-timing.mjs uses the same value.
const SCRIPTED_MOTION_RMS = 0.3;

// The A17 films Shravan and the iPhone films Nitin (people.ts); attempt 1 is the refused reading.
export function recordingFor(attempt: 1 | 2): ShowcaseRecording {
  const ios = Platform.OS === 'ios';
  const recordings = {
    1: ios ? nitinAttempt1 : shravanAttempt1,
    2: ios ? nitinScan : shravanScan,
  };
  return recordings[attempt] as ShowcaseRecording;
}

let capturesStarted = 0;

// The first capture of a run is the refused attempt; every later one is the good scan.
export function nextShowcaseAttempt(): 1 | 2 {
  capturesStarted += 1;
  return capturesStarted === 1 ? 1 : 2;
}

// ReplayCapture's status always reports a covered lens and no motion. The film needs both to follow the
// recording: the finger chip reads the newest frame's DSP-4 contact, and motionRms follows `motion`, so the
// live session rejects those stretches and shows "Hold still" as it does on a moving phone.
export class ShowcaseReplay extends ReplayCapture {
  private readonly motion: ShowcaseRecording['motion'];
  private readonly firstNs: number;
  private newest: { sample: Sample; stat: FrameStat } | null = null;

  constructor(recording: ShowcaseRecording) {
    super(recording);
    this.motion = recording.motion;
    this.firstNs = recording.samples.tNs[0] ?? 0;
    super.addListener('samples', ({ samples, stats }) => {
      const sample = samples[samples.length - 1];
      const stat = stats[stats.length - 1];
      if (sample && stat) this.newest = { sample, stat };
    });
  }

  override addListener<E extends keyof LumenCaptureEvents>(
    e: E,
    cb: LumenCaptureEvents[E],
  ): { remove(): void } {
    if (e !== 'status') return super.addListener(e, cb);
    const forward = cb as LumenCaptureEvents['status'];
    return super.addListener('status', (status) => forward(this.scripted(status)));
  }

  private scripted(status: CaptureStatus): CaptureStatus {
    if (this.newest === null) return status;
    const { sample, stat } = this.newest;
    const atS = (sample.tNs - this.firstNs) / 1e9;
    const moving = this.motion.some(({ fromS, toS }) => atS >= fromS && atS < toS);
    return {
      ...status,
      fingerCovered: frameProblem(sample, stat) !== 'coverage',
      motionRms: moving ? SCRIPTED_MOTION_RMS : 0,
    };
  }
}
