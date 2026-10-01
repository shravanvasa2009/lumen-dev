import {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
} from 'expo/config-plugins';

// Spec §9.5, verbatim. The Spanish string awaits review by a fluent speaker (owner decision 2026-09-30).
const CAMERA_PURPOSE_EN =
  'Lumen uses your camera and flashlight to measure your pulse. Video is never saved.';
const CAMERA_PURPOSE_ES = 'Lumen usa la cámara y la linterna para medir tu pulso. El video nunca se guarda.';

// Not required, so the store does not hide Lumen from phones without a flash: those phones get the
// ambient-light fallback and a lower compatibility tier (spec §4, COMP-1).
const OPTIONAL_FEATURES = ['android.hardware.camera', 'android.hardware.camera.flash'];

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

function addOptionalCameraFeatures(manifest: AndroidManifest): AndroidManifest {
  const features = manifest.manifest['uses-feature'] ?? [];
  for (const name of OPTIONAL_FEATURES) {
    if (!features.some((feature) => feature.$['android:name'] === name)) {
      features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
  }
  manifest.manifest['uses-feature'] = features;
  return manifest;
}

// Expo's built-in locales step writes each locale's `ios` keys to <lang>.lproj/InfoPlist.strings.
const withSpanishCameraPurpose: ConfigPlugin = (config) => {
  const existing = config.locales?.es;
  if (typeof existing === 'string') {
    throw new Error(
      'lumen-capture: locales.es is a JSON file path; add NSCameraUsageDescription to that file instead.',
    );
  }
  config.locales = {
    ...config.locales,
    es: {
      ...existing,
      ios: { ...existing?.ios, NSCameraUsageDescription: CAMERA_PURPOSE_ES },
    },
  };
  return config;
};

const withLumenCaptureOnce: ConfigPlugin = (config) => {
  config = withInfoPlist(config, (plistConfig) => {
    plistConfig.modResults.NSCameraUsageDescription = CAMERA_PURPOSE_EN;
    return plistConfig;
  });
  config = withSpanishCameraPurpose(config);
  config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.CAMERA']);
  return withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = addOptionalCameraFeatures(manifestConfig.modResults);
    return manifestConfig;
  });
};

const withLumenCapture = createRunOncePlugin(withLumenCaptureOnce, 'lumen-capture');

// Default export: Expo loads a plugin listed by path in app.config.ts from its default export.
export default withLumenCapture;
