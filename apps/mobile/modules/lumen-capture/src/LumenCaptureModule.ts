import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
  CameraPermission,
  Capabilities,
  CaptureConfig,
  CaptureStarted,
  CaptureSummary,
  LumenCaptureEvents,
  LumenCaptureModule,
} from './LumenCapture.types';

declare class LumenCaptureNative extends NativeModule<LumenCaptureEvents> {
  getCapabilities(): Promise<Capabilities>;
  getPermission(): Promise<CameraPermission>;
  requestPermission(): Promise<CameraPermission>;
  start(config: CaptureConfig): Promise<CaptureStarted>;
  stop(): Promise<CaptureSummary>;
  setTorch(level: number): Promise<void>;
  lockExposure(): Promise<void>;
  setPreviewEnabled?(enabled: boolean): Promise<void>;
}

// The annotation is the conformance check: tsc fails if the native binding drifts from Appendix A.
// null where the module is not linked (Jest, Expo Go), so importing this file never throws and callers
// can fall back to ReplayCapture.
export const LumenCapture: LumenCaptureModule | null =
  requireOptionalNativeModule<LumenCaptureNative>('LumenCapture');
