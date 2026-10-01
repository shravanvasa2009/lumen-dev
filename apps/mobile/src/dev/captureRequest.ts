import type {
  Capabilities,
  CaptureSummary,
  LabDiagnostics,
  SampleBatch,
} from '../../modules/lumen-capture/src';

// The Appendix B meta fields known when a Lab capture stops. The phone does not know rating, subject,
// context, or labels yet, so they are left out rather than guessed.
interface CaptureMeta {
  app?: string;
  platform: Capabilities['platform'];
  modelId: string;
  os: string;
  mode: 'full';
  lensId?: string;
  fps?: number;
  torchLevel?: number;
}

// Appendix B "Capture receiver request"; polarRr is optional and Lab has no chest strap yet.
export interface CaptureRequestBody {
  meta: CaptureMeta;
  samples: { tNs: number[]; r: number[]; g: number[]; b: number[] };
  stats: { tNs: number[]; spatialStdR: number[]; clipFrac: number[]; exposureNs: number[] };
}

interface CaptureContext {
  appVersion?: string;
  capabilities: Capabilities;
  summary: CaptureSummary;
  // The last 1 Hz Lab event; replayed recordings have none, so fps and torchLevel are then unknown.
  lab?: LabDiagnostics;
}

export function captureRequestBody(
  batches: readonly SampleBatch[],
  { appVersion, capabilities, summary, lab }: CaptureContext,
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
  };
}
