import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
  CameraPermission,
  Capabilities,
  CaptureConfig,
  CaptureStarted,
  CaptureSummary,
  CareSearch,
  LumenCaptureEvents,
  LumenCaptureModule,
  NearbyPlace,
} from './LumenCapture.types';

declare class LumenCaptureNative extends NativeModule<LumenCaptureEvents> {
  getCapabilities(): Promise<Capabilities>;
  getPermission(): Promise<CameraPermission>;
  requestPermission(): Promise<CameraPermission>;
  start(config: CaptureConfig): Promise<CaptureStarted>;
  stop(): Promise<CaptureSummary>;
  setTorch(level: number): Promise<void>;
  lockExposure(): Promise<void>;
  // Defined only by the Swift module (ADR 0054 §4).
  searchNearbyCare?(lat: number, lon: number, radiusM: number, query: string): Promise<NearbyPlace[]>;
}

// The annotation is the conformance check: tsc fails if the native binding drifts from Appendix A.
// null where the module is not linked (Jest, Expo Go), so importing this file never throws and callers
// can fall back to ReplayCapture.
const native = requireOptionalNativeModule<LumenCaptureNative>('LumenCapture');
export const LumenCapture: LumenCaptureModule | null = native;

// Must match careSearchThrottledCode in ios/CareSearch.swift.
export const CARE_SEARCH_THROTTLED_CODE = 'ERR_CARE_SEARCH_THROTTLED';

// null on Android (which has no native search; ADR 0054 §4), in builds made before the function shipped, and
// where the module is not linked.
const nativeSearch = native?.searchNearbyCare?.bind(native);
export const LumenCareSearch: CareSearch | null = nativeSearch ? { searchNearbyCare: nativeSearch } : null;
