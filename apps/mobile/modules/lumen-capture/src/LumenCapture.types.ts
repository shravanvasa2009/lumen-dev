export interface Sample {          // one frame; r, g, b are means over the finger region, 0..1
  tNs: number; r: number; g: number; b: number;
}
export interface FrameStat {
  tNs: number; spatialStdR: number; clipFrac: number;
  exposureNs: number;              // exposure duration of this frame
}
export interface SampleBatch { samples: Sample[]; stats: FrameStat[] } // every 100 ms

export interface CaptureStatus {
  fingerCovered: boolean; motionRms: number;
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
  fps: number; droppedFrac: number;                            // emitted at 4 Hz
}
export interface LensInfo {
  id: string; kind: 'wide' | 'ultrawide' | 'tele' | 'unknown';
  maxFps: number; torchUsable: boolean;
}
export interface Capabilities {
  platform: 'ios' | 'android'; modelId: string; osVersion: string;
  rearLenses: LensInfo[];
  torch: { available: boolean; levels: boolean };
  locks: { exposure: boolean; whiteBalance: boolean; focus: boolean };
}
export interface CaptureConfig {
  lensId?: string; targetFps?: number;
  torchLevel?: number;                 // 0 = off (ambient mode), 0..1
  exposureTarget?: [number, number];   // red-mean window, default [0.55, 0.80]
}
export interface CaptureSummary {
  startedNs: number; stoppedNs: number; lensId?: string;
  frames: number; dropped: number;
}
export interface LumenCaptureModule {
  getCapabilities(): Promise<Capabilities>;
  start(config: CaptureConfig): Promise<void>;
  stop(): Promise<CaptureSummary>;
  setTorch(level: number): Promise<void>;
  lockExposure(): Promise<void>;
  addListener(e: 'samples', cb: (b: SampleBatch) => void): { remove(): void };
  addListener(e: 'status', cb: (s: CaptureStatus) => void): { remove(): void };
}
