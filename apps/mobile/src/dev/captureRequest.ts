import type { RatingTier } from '@lumen/core';

import type {
  Capabilities,
  CaptureSummary,
  LabDiagnostics,
  SampleBatch,
} from '../../modules/lumen-capture/src';

// The Appendix B meta fields known when a Lab capture is sent, plus recordedAt and restTimerDone, which the
// §10.1 flag rules need (order C.AB). An unrated phone sends no rating, and the phone does not know the
// subject or the context yet, so those are left out rather than guessed.
interface CaptureMeta {
  app?: string;
  platform: Capabilities['platform'];
  modelId: string;
  os: string;
  mode: 'full';
  lensId?: string;
  fps?: number;
  torchLevel?: number;
  rating?: PhoneRating;
  recordedAt?: string;
  restTimerDone?: boolean;
  labels?: { pacedBrpm: number };
}

// The §5 rating the phone held when the capture started (Appendix B meta "rating").
export interface PhoneRating {
  score: number;
  tier: RatingTier;
}

// Strap RR intervals in ms, each stamped on the camera's tNs clock (order E.B polar-clock).
export interface PolarRr {
  tNs: number[];
  rrMs: number[];
}

// Appendix B "Capture receiver request"; polarRr only when a chest strap was connected during the capture.
export interface CaptureRequestBody {
  meta: CaptureMeta;
  samples: { tNs: number[]; r: number[]; g: number[]; b: number[] };
  stats: { tNs: number[]; spatialStdR: number[]; clipFrac: number[]; exposureNs: number[] };
  polarRr?: PolarRr;
}

interface CaptureContext {
  appVersion?: string;
  capabilities: Capabilities;
  summary: CaptureSummary;
  // The last 1 Hz Lab event; replayed recordings have none, so fps and torchLevel are then unknown.
  lab?: LabDiagnostics;
  polarRr?: PolarRr;
  rating?: PhoneRating;
  recordedAt?: Date;
  restTimerDone?: boolean;
  // Metronome rate of a paced-breathing capture (Track E's RESP-1 check).
  pacedBrpm?: number;
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

// ISO 8601 in the phone's local time with its UTC offset, e.g. 2026-10-04T07:41:58-05:00: the §10.1
// 24-hour and different-days rules count the person's local days, which a UTC "Z" time would hide.
function localIsoWithOffset(when: Date): string {
  const offsetMin = -when.getTimezoneOffset();
  const offsetAbs = Math.abs(offsetMin);
  const date = `${when.getFullYear()}-${twoDigits(when.getMonth() + 1)}-${twoDigits(when.getDate())}`;
  const time = `${twoDigits(when.getHours())}:${twoDigits(when.getMinutes())}:${twoDigits(when.getSeconds())}`;
  const offset = `${offsetMin < 0 ? '-' : '+'}${twoDigits(Math.floor(offsetAbs / 60))}:${twoDigits(offsetAbs % 60)}`;
  return `${date}T${time}${offset}`;
}

export function captureRequestBody(
  batches: readonly SampleBatch[],
  {
    appVersion,
    capabilities,
    summary,
    lab,
    polarRr,
    rating,
    recordedAt,
    restTimerDone,
    pacedBrpm,
  }: CaptureContext,
): CaptureRequestBody {
  const samples = batches.flatMap((batch) => batch.samples);
  const stats = batches.flatMap((batch) => batch.stats);
  const lensId = summary.lensId ?? lab?.lensId;
  const meta: CaptureMeta = {
    ...(appVersion === undefined ? {} : { app: appVersion }),
    platform: capabilities.platform,
    modelId: capabilities.modelId,
    os: capabilities.osVersion,
    mode: 'full',
    ...(lensId === undefined ? {} : { lensId }),
    ...(lab ? { fps: lab.targetFps, torchLevel: lab.torchOn ? lab.torchLevel : 0 } : {}),
    ...(rating ? { rating: { score: rating.score, tier: rating.tier } } : {}),
    ...(recordedAt ? { recordedAt: localIsoWithOffset(recordedAt) } : {}),
    ...(restTimerDone === undefined ? {} : { restTimerDone }),
    ...(pacedBrpm === undefined ? {} : { labels: { pacedBrpm } }),
  };
  return {
    meta,
    samples: {
      tNs: samples.map((sample) => sample.tNs),
      r: samples.map((sample) => sample.r),
      g: samples.map((sample) => sample.g),
      b: samples.map((sample) => sample.b),
    },
    stats: {
      tNs: stats.map((stat) => stat.tNs),
      spatialStdR: stats.map((stat) => stat.spatialStdR),
      clipFrac: stats.map((stat) => stat.clipFrac),
      exposureNs: stats.map((stat) => stat.exposureNs),
    },
    ...(polarRr ? { polarRr } : {}),
  };
}
