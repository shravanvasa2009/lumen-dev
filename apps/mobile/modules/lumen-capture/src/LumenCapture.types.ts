// One frame; r, g, b are means over the finger region, 0..1.
export interface Sample {
  tNs: number;
  r: number;
  g: number;
  b: number;
}
export interface FrameStat {
  tNs: number;
  spatialStdR: number;
  clipFrac: number;
  exposureNs: number; // exposure duration of this frame
}
// Emitted every 100 ms.
export interface SampleBatch {
  samples: Sample[];
  stats: FrameStat[];
}

// Emitted at 4 Hz.
export interface CaptureStatus {
  fingerCovered: boolean;
  motionRms: number;
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
  fps: number; // frames received over the last 1 s
  droppedFrac: number; // dropped / (received + dropped) since start(), matching CAP-1's whole-capture limit
}
export interface LensInfo {
  id: string;
  kind: 'wide' | 'ultrawide' | 'tele' | 'unknown';
  maxFps: number;
  torchUsable: boolean;
}
export interface Capabilities {
  platform: 'ios' | 'android';
  modelId: string;
  osVersion: string;
  rearLenses: LensInfo[];
  torch: { available: boolean; levels: boolean };
  locks: { exposure: boolean; whiteBalance: boolean; focus: boolean };
}
export interface CaptureConfig {
  lensId?: string;
  targetFps?: number;
  torchLevel?: number; // 0 = off (ambient mode), 0..1
  exposureTarget?: [number, number]; // red-mean window, default [0.55, 0.80]
}
// What start() resolves with (ADR 0067). activeFps can be lower than targetFps when the lens or platform caps
// the rate. iOS reads it back from the device after start; Android reports the top of the frame-rate range it
// requested (the camera can run below it when that range is variable); Replay reports the recording's rate.
export interface CaptureStarted {
  activeFps: number;
}
export interface CaptureSummary {
  startedNs: number;
  stoppedNs: number;
  lensId?: string;
  frames: number;
  dropped: number;
}
// Same shape as Expo's PermissionResponse, so screens can treat it like any Expo permission (ADR 0013).
export interface CameraPermission {
  status: 'granted' | 'undetermined' | 'denied';
  expires: 'never' | number;
  granted: boolean;
  canAskAgain: boolean;
}

// Development builds only, emitted at 1 Hz for Lab mode; app code never reads it (ADR 0013).
export interface LabDiagnostics {
  lensId: string;
  formatWidth: number;
  formatHeight: number;
  targetFps: number;
  frameWorkMsMean: number; // native per-frame reduction time; budget < 4 ms at 60 fps (spec §9.3)
  frameWorkMsMax: number;
  iso: number;
  exposureNs: number;
  torchOn: boolean;
  torchLevel: number;
  locked: { exposure: boolean; whiteBalance: boolean; focus: boolean };
}

// ADR 0097 (proposed): a live-view thumbnail of the whole analysis frame, about 10 a second, sent only while JS
// listens to 'preview' and has not called setPreviewEnabled(false). Only Android sends it for now; iOS and
// ReplayCapture send none, so the view falls back to the sample colours. Never stored or sent off the phone.
export interface PreviewFrame {
  tNs: number;
  width: number; // 80
  height: number; // 60
  rgb: string; // base64 of width * height * 3 bytes, row-major RGB8
}

// Event name to payload, matching the addListener overloads below; the native binding is typed with it.
export type LumenCaptureEvents = {
  samples: (b: SampleBatch) => void;
  status: (s: CaptureStatus) => void;
  lab: (d: LabDiagnostics) => void;
  preview: (p: PreviewFrame) => void;
};

export interface LumenCaptureModule {
  getCapabilities(): Promise<Capabilities>;
  getPermission(): Promise<CameraPermission>;
  requestPermission(): Promise<CameraPermission>;
  start(config: CaptureConfig): Promise<CaptureStarted>;
  stop(): Promise<CaptureSummary>;
  setTorch(level: number): Promise<void>;
  // Locks exposure, white balance, and focus together (spec §4.2 step 3; ADR 0013).
  lockExposure(): Promise<void>;
  // ADR 0097: optional because only the Android module has it yet. Turning the preview on or off never touches
  // the session, torch or locks.
  setPreviewEnabled?(enabled: boolean): Promise<void>;
  addListener(e: 'samples', cb: (b: SampleBatch) => void): { remove(): void };
  addListener(e: 'status', cb: (s: CaptureStatus) => void): { remove(): void };
  addListener(e: 'lab', cb: (d: LabDiagnostics) => void): { remove(): void };
  addListener(e: 'preview', cb: (p: PreviewFrame) => void): { remove(): void };
}
