import type { ExpoConfig } from 'expo/config';

import brandSnippet from './app.config.brand.json';

// The display name is swappable (spec §2); the bundle identifier is not after the first upload (ADR 0007).
export const APP_NAME = 'Lumen';
const BUNDLE_ID = 'io.github.shravanvasa2009.heartcheck';

// JSON imports widen literals ("automatic", plugin tuples) to plain strings and arrays; the snippet is
// written in Expo's config shape, and scripts/check-assets.mjs validates it in CI.
const brand = brandSnippet.expo as ExpoConfig;

// Free Apple ID ("Personal Team") builds on the partner's Mac (ADR 0034): a separate iOS bundle ID so the
// free team never claims the real one, and lumen-capture drops the push entitlement free teams cannot sign.
// Without a team ID, `expo run:ios` picks the team from the Mac's signing certificate and lets xcodebuild
// fetch the profile (-allowProvisioningUpdates); a preset team makes it skip that flag.
// Fails closed: a typo such as "true" must not quietly build the real bundle ID with a free team.
const personalTeamFlag = process.env.LUMEN_IOS_PERSONAL_TEAM ?? '';
if (!['', '0', '1'].includes(personalTeamFlag)) {
  throw new Error(`LUMEN_IOS_PERSONAL_TEAM must be 1 (on) or 0 or unset (off); got "${personalTeamFlag}".`);
}
const personalTeam = personalTeamFlag === '1';
const teamId = process.env.LUMEN_IOS_TEAM_ID || undefined;
// Apple team IDs are 10 upper-case letters and digits.
if (personalTeam && teamId !== undefined && !/^[A-Z0-9]{10}$/.test(teamId)) {
  throw new Error(
    `LUMEN_IOS_TEAM_ID must be your 10-character Apple team ID (got "${teamId}"); leave it unset to let expo run:ios pick the team.`,
  );
}
let iosSigning: { bundleIdentifier: string; appleTeamId?: string } = { bundleIdentifier: BUNDLE_ID };
if (personalTeam) {
  iosSigning = { bundleIdentifier: `${BUNDLE_ID}.dev` };
  if (teamId) {
    iosSigning.appleTeamId = teamId;
  }
}
const capturePlugin = './modules/lumen-capture/app.plugin';
// Lab mode's chest-strap reference (spec §9.5, ADR 0039). The H10 is found by its Heart Rate service, not by
// location, and is only used in the foreground.
const blePlugin: [string, Record<string, unknown>] = [
  'react-native-ble-plx',
  {
    isBackgroundEnabled: false,
    neverForLocation: true,
    bluetoothAlwaysPermission: 'Used only in Lab mode to compare Lumen with a heart-rate chest strap.',
  },
];

// Care map (ADR 0054): foreground location only, asked when the map opens. The Always and motion keys are
// switched off (false) so they never reach Info.plist; background modes default to off.
const locationPlugin: [string, Record<string, unknown>] = [
  'expo-location',
  {
    locationWhenInUsePermission:
      'Lumen uses your location only to show care near you. It is not saved or sent to Lumen.',
    locationAlwaysAndWhenInUsePermission: false,
    locationAlwaysPermission: false,
    motionUsagePermission: false,
    isIosBackgroundLocationEnabled: false,
    isAndroidBackgroundLocationEnabled: false,
  },
];

const config: ExpoConfig = {
  ...brand,
  name: APP_NAME,
  slug: 'heartcheck',
  // EAS project created with `eas init --account lumen-capp-team` (ADR 0009).
  owner: 'lumen-capp-team',
  version: '0.1.0',
  orientation: 'portrait',
  ios: { ...brand.ios, ...iosSigning, supportsTablet: false },
  android: { ...brand.android, package: BUNDLE_ID },
  plugins: [
    'expo-router',
    'expo-dev-client',
    ...(brand.plugins ?? []),
    blePlugin,
    locationPlugin,
    '@maplibre/maplibre-react-native',
    personalTeam ? [capturePlugin, { personalTeam: true }] : capturePlugin,
  ],
  // No over-the-air updates: release builds make no network requests (PRIV-1).
  updates: { enabled: false },
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: 'db228fc8-a593-4e0d-a2f7-fdac78228c79' } },
};

export default config;
