import { frameProblem } from '@lumen/core';
import { Platform } from 'react-native';

import {
  type CaptureConfig,
  type CaptureStarted,
  type CaptureStatus,
  type CaptureSummary,
  type FrameStat,
  type LumenCaptureEvents,
  type RecordedCapture,
  ReplayCapture,
  type Sample,
} from '../../modules/lumen-capture/src';
import nitinPractice from './recordings/nitin-practice.json';
import nitinScan from './recordings/nitin-scan.json';
import shravanPractice from './recordings/shravan-practice.json';
import shravanScan from './recordings/shravan-scan.json';
import { SLIP, startFilmVideo, stopFilmVideo, type Take } from './filmVideo';

// tools/showcase/recording.mjs writes these; `motion` holds the stretches, in seconds from the first frame,
// when the person moved. A Lab capture has no accelerometer stream, so the cue sheet's stretches stand in.
type ShowcaseRecording = RecordedCapture & {
  origin: string;
  motion: { fromS: number; toS: number }[];
};

// Green and blue against red while the finger is half off: well under DSP-4's R ≥ 2 (G + B), so the live session
// rejects those frames and coaches "Cover the lens and the flash." as it does when a real finger slips.
const SLIPPED_GREEN_BLUE_SHARE = 0.4;

// Well above live.motionRmsThreshold (0.05 g); tools/showcase/check-timing.mjs uses the same value.
const SCRIPTED_MOTION_RMS = 0.3;

// The A17 films Shravan and the iPhone films Nitin (people.ts): the setup's practice take and the Full Scan take.
export function recordingFor(take: Take): ShowcaseRecording {
  const ios = Platform.OS === 'ios';
  const recordings = {
    practice: ios ? nitinPractice : shravanPractice,
    scan: ios ? nitinScan : shravanScan,
  };
  return recordings[take] as ShowcaseRecording;
}

function withSlip(recording: ShowcaseRecording): ShowcaseRecording {
  const firstNs = recording.samples.tNs[0] ?? 0;
  const { tNs, r, g, b } = recording.samples;
  const slipped = tNs.map((ns) => {
    const atS = (ns - firstNs) / 1e9;
    return atS >= SLIP.fromS && atS < SLIP.toS;
  });
  const greenBlue = (channel: number[]) =>
    channel.map((value, i) => (slipped[i] ? SLIPPED_GREEN_BLUE_SHARE * r[i]! : value));
  return { ...recording, samples: { tNs, r, g: greenBlue(g), b: greenBlue(b) } };
}

// ReplayCapture's status always reports a covered lens and no motion. The film needs both to follow the
// recording: the finger chip reads the newest frame's DSP-4 contact, and motionRms follows `motion`, so the
// live session rejects those stretches and shows "Hold still" as it does on a moving phone.
// The take's finger video starts when the replay starts emitting and stops with it (filmVideo.tsx).
// Defined on first use: screens that import this file are tested with the capture module mocked, where
// ReplayCapture is not a class yet.
let replayClass: (new (take: Take) => ReplayCapture) | null = null;

export function showcaseReplay(take: Take): ReplayCapture {
  replayClass ??= class extends ReplayCapture {
    private readonly motion: ShowcaseRecording['motion'];
    private readonly firstNs: number;
    private newest: { sample: Sample; stat: FrameStat } | null = null;

    private readonly take: Take;

    constructor(take: Take) {
      const recording = take === 'scan' ? withSlip(recordingFor(take)) : recordingFor(take);
      super(recording);
      this.take = take;
      this.motion = recording.motion;
      this.firstNs = recording.samples.tNs[0] ?? 0;
      super.addListener('samples', ({ samples, stats }) => {
        const sample = samples[samples.length - 1];
        const stat = stats[stats.length - 1];
        if (sample && stat) this.newest = { sample, stat };
      });
    }

    override async start(config: CaptureConfig): Promise<CaptureStarted> {
      const started = await super.start(config);
      startFilmVideo(this.take);
      return started;
    }

    override async stop(): Promise<CaptureSummary> {
      stopFilmVideo();
      return super.stop();
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
  };
  return new replayClass(take);
}
