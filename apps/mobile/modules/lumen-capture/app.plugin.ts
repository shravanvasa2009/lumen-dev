import {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withBaseMod,
  withInfoPlist,
  type ConfigPlugin,
} from 'expo/config-plugins';

// Spec §9.5, verbatim apart from the name, which comes from the config so a rename reaches the prompt
// (spec §2). The Spanish string awaits review by a fluent speaker (owner decision 2026-09-30).
const cameraPurposeEn = (appName: string) =>
  `${appName} uses your camera and flashlight to measure your pulse. Video is never saved.`;
const cameraPurposeEs = (appName: string) =>
  `${appName} usa la cámara y la linterna para medir tu pulso. El video nunca se guarda.`;

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
      ios: { ...existing?.ios, NSCameraUsageDescription: cameraPurposeEs(config.name) },
    },
  };
  return config;
};

type LumenCaptureProps = { personalTeam?: boolean } | void;

// Free Apple ID teams cannot sign the push entitlement that expo-notifications adds (ADR 0034); local
// reminders do not need it. Entitlements mods run newest first, so a plain withEntitlementsPlist mod here
// would run before expo-notifications' (listed earlier in app.config.ts) and see its key re-added.
// withBaseMod hands this mod the rest of the chain as nextMod, so the key is removed after every other
// plugin has run, whatever the plugin order.
const withoutPushEntitlement: ConfigPlugin = (config) =>
  withBaseMod<Record<string, unknown>>(config, {
    platform: 'ios',
    mod: 'entitlements',
    async action({ modRequest, ...chainConfig }) {
      // Typed optional in ModProps, but withBaseMod always sets it (a no-op when nothing is chained).
      if (!modRequest.nextMod) {
        throw new Error('lumen-capture: withBaseMod passed no nextMod for ios.entitlements.');
      }
      const entitlementsConfig = await modRequest.nextMod({ ...chainConfig, modRequest });
      delete entitlementsConfig.modResults['aps-environment'];
      return entitlementsConfig;
    },
  });

const withLumenCaptureOnce: ConfigPlugin<LumenCaptureProps> = (config, props) => {
  if (props?.personalTeam) {
    config = withoutPushEntitlement(config);
  }
  config = withInfoPlist(config, (plistConfig) => {
    plistConfig.modResults.NSCameraUsageDescription = cameraPurposeEn(plistConfig.name);
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
