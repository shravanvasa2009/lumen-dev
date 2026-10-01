import { NativeModule, requireNativeModule } from 'expo';

import type {
  CameraPermission,
  Capabilities,
  CaptureConfig,
  CaptureSummary,
  LumenCaptureEvents,
  LumenCaptureModule,
} from './LumenCapture.types';

declare class LumenCaptureNative extends NativeModule<LumenCaptureEvents> {
  getCapabilities(): Promise<Capabilities>;
  getPermission(): Promise<CameraPermission>;
  requestPermission(): Promise<CameraPermission>;
  start(config: CaptureConfig): Promise<void>;
  stop(): Promise<CaptureSummary>;
  setTorch(level: number): Promise<void>;
  lockExposure(): Promise<void>;
}

// The annotation is the conformance check: tsc fails if the native binding drifts from Appendix A.
export const LumenCapture: LumenCaptureModule = requireNativeModule<LumenCaptureNative>('LumenCapture');
