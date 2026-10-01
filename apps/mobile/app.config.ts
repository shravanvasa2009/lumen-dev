import type { ExpoConfig } from 'expo/config';

import brandSnippet from './app.config.brand.json';

// The display name is swappable (spec §2); the bundle identifier is not after the first upload (ADR 0007).
export const APP_NAME = 'Lumen';
const BUNDLE_ID = 'io.github.shravanvasa2009.heartcheck';

// JSON imports widen literals ("automatic", plugin tuples) to plain strings and arrays; the snippet is
// written in Expo's config shape, and scripts/check-assets.mjs validates it in CI.
const brand = brandSnippet.expo as ExpoConfig;

const config: ExpoConfig = {
  ...brand,
  name: APP_NAME,
  slug: 'heartcheck',
  // EAS project created with `eas init --account lumen-capp-team` (ADR 0009).
  owner: 'lumen-capp-team',
  version: '0.1.0',
  orientation: 'portrait',
  ios: { ...brand.ios, bundleIdentifier: BUNDLE_ID, supportsTablet: false },
  android: { ...brand.android, package: BUNDLE_ID },
  plugins: ['expo-router', 'expo-dev-client', ...(brand.plugins ?? [])],
  // No over-the-air updates: release builds make no network requests (PRIV-1).
  updates: { enabled: false },
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: 'db228fc8-a593-4e0d-a2f7-fdac78228c79' } },
};

export default config;
