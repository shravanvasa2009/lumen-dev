/** @jest-environment node */
import type { ExpoConfig } from 'expo/config';
import { AndroidConfig, compileModsAsync } from 'expo/config-plugins';
// app.plugin.js re-exports this build file and ships no types.
import withNotifications from 'expo-notifications/plugin/build/withNotifications';

import withLumenCapture from './app.plugin';

// The app tsconfig has no Node types, so the Node modules this test needs are typed here.
const fs = jest.requireActual<{
  mkdtempSync(prefix: string): string;
  rmSync(dir: string, options: { recursive: true; force: true }): void;
}>('fs');
const os = jest.requireActual<{ tmpdir(): string }>('os');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

// Introspection runs the Info.plist and AndroidManifest mods in memory. An empty project root makes
// them start from Expo's templates; a root with a manifest makes them start from that file, like a
// second prebuild without --clean.
async function introspect(projectRoot: string, applyTwice = false): Promise<ExpoConfig> {
  let config: ExpoConfig = {
    name: 'Lumen',
    slug: 'lumen-test',
    ios: { bundleIdentifier: 'test.lumen' },
    android: { package: 'test.lumen' },
    _internal: { projectRoot },
  };
  config = withLumenCapture(config);
  if (applyTwice) {
    config = withLumenCapture(config);
  }
  return compileModsAsync(config, {
    projectRoot,
    introspect: true,
    platforms: ['ios', 'android'],
  });
}

function manifestOf(config: ExpoConfig): AndroidManifest {
  return config._internal?.modResults.android.manifest;
}

function namesIn<Entry extends { $: { 'android:name': string } }>(
  entries: Entry[] | undefined,
  name: string,
) {
  return (entries ?? []).filter((entry) => entry.$['android:name'] === name);
}

// The first compileModsAsync in a test process lazily loads and Babel-transforms the iOS and Android
// config-plugin modules and reads Expo's Info.plist and AndroidManifest templates. Measured on the
// owner's 28-thread PC with a cold Jest cache and the whole mobile suite running in parallel: 5.7-6.5 s
// as the first test (past Jest's 5 s default) and 4.8-12 s in this hook; under 0.2 s warm. So the
// plain template run is done once here, with about 2.5x headroom, and shared by the tests that only
// read it.
const COLD_INTROSPECTION_MS = 30_000;

describe('lumen-capture config plugin (CAP-2)', () => {
  let projectRoot: string;
  let templateRoot: string;
  let fromTemplates: ExpoConfig;

  beforeAll(async () => {
    templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-plugin-'));
    fromTemplates = await introspect(templateRoot);
  }, COLD_INTROSPECTION_MS);

  afterAll(() => {
    fs.rmSync(templateRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-plugin-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('sets the English iOS camera purpose string from spec §9.5', () => {
    expect(fromTemplates.ios?.infoPlist?.NSCameraUsageDescription).toBe(
      'Lumen uses your camera and flashlight to measure your pulse. Video is never saved.',
    );
  });

  it('adds the Spanish iOS camera purpose string to the es locale', () => {
    expect(fromTemplates.locales?.es).toEqual({
      ios: {
        NSCameraUsageDescription:
          'Lumen usa la cámara y la linterna para medir tu pulso. El video nunca se guarda.',
      },
    });
  });

  it('keeps other locales and other keys in the es locale', () => {
    const config = withLumenCapture({
      name: 'Lumen',
      slug: 'lumen-test',
      locales: {
        fr: 'locales/fr.json',
        es: { CFBundleDisplayName: 'Lumen', ios: { NSFaceIDUsageDescription: 'x' } },
      },
    });
    expect(config.locales).toEqual({
      fr: 'locales/fr.json',
      es: {
        CFBundleDisplayName: 'Lumen',
        ios: {
          NSFaceIDUsageDescription: 'x',
          NSCameraUsageDescription:
            'Lumen usa la cámara y la linterna para medir tu pulso. El video nunca se guarda.',
        },
      },
    });
  });

  it('puts the configured app name into both purpose strings', async () => {
    const config = await compileModsAsync(
      withLumenCapture({ name: 'Flicker', slug: 'lumen-test', _internal: { projectRoot } }),
      { projectRoot, introspect: true, platforms: ['ios'] },
    );
    expect(config.ios?.infoPlist?.NSCameraUsageDescription).toMatch(/^Flicker uses your camera/);
    expect(config.locales?.es).toEqual({
      ios: { NSCameraUsageDescription: expect.stringMatching(/^Flicker usa la cámara/) },
    });
  });

  it('refuses a locales.es file path instead of overwriting it', () => {
    expect(() =>
      withLumenCapture({ name: 'Lumen', slug: 'lumen-test', locales: { es: 'locales/es.json' } }),
    ).toThrow(/locales\.es is a JSON file path/);
  });

  it('requests CAMERA and marks camera and flash as optional features on Android', () => {
    const manifest = manifestOf(fromTemplates).manifest;
    expect(namesIn(manifest['uses-permission'], 'android.permission.CAMERA')).toHaveLength(1);
    for (const feature of ['android.hardware.camera', 'android.hardware.camera.flash']) {
      const entries = namesIn(manifest['uses-feature'], feature);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.$['android:required']).toBe('false');
    }
  });

  it('adds nothing twice when run again on its own output', async () => {
    const firstRun = manifestOf(await introspect(projectRoot));
    await AndroidConfig.Manifest.writeAndroidManifestAsync(
      path.join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      firstRun,
    );
    const manifest = manifestOf(await introspect(projectRoot)).manifest;
    expect(namesIn(manifest['uses-permission'], 'android.permission.CAMERA')).toHaveLength(1);
    expect(namesIn(manifest['uses-feature'], 'android.hardware.camera')).toHaveLength(1);
    expect(namesIn(manifest['uses-feature'], 'android.hardware.camera.flash')).toHaveLength(1);
  });

  it('adds nothing twice when listed twice in the plugins', async () => {
    const manifest = manifestOf(await introspect(projectRoot, true)).manifest;
    expect(namesIn(manifest['uses-permission'], 'android.permission.CAMERA')).toHaveLength(1);
    expect(namesIn(manifest['uses-feature'], 'android.hardware.camera')).toHaveLength(1);
    expect(namesIn(manifest['uses-feature'], 'android.hardware.camera.flash')).toHaveLength(1);
  });
});

// expo-notifications adds aps-environment through its own entitlements mod; app.config.ts lists it before
// lumen-capture, and the other order is checked too so the result does not depend on plugin order.
async function entitlementsAfter(
  projectRoot: string,
  order: 'notifications-first' | 'notifications-last',
  personalTeam: boolean,
) {
  let config: ExpoConfig = {
    name: 'Lumen',
    slug: 'lumen-test',
    ios: { bundleIdentifier: 'test.lumen', entitlements: { 'keychain-access-groups': ['test'] } },
    _internal: { projectRoot },
  };
  const withCapture = (current: ExpoConfig) =>
    personalTeam ? withLumenCapture(current, { personalTeam }) : withLumenCapture(current);
  if (order === 'notifications-first') {
    config = withCapture(withNotifications(config, {}));
  } else {
    config = withNotifications(withCapture(config), {});
  }
  const compiled = await compileModsAsync(config, { projectRoot, introspect: true, platforms: ['ios'] });
  return compiled.ios?.entitlements;
}

describe('lumen-capture personal-team mode (CAP-2, BOOT)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-plugin-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('keeps the push entitlement from expo-notifications by default', async () => {
    const entitlements = await entitlementsAfter(projectRoot, 'notifications-first', false);
    expect(entitlements?.['aps-environment']).toBe('development');
  });

  it.each(['notifications-first', 'notifications-last'] as const)(
    'removes the push entitlement in personal-team mode (%s)',
    async (order) => {
      const entitlements = await entitlementsAfter(projectRoot, order, true);
      expect(entitlements).not.toHaveProperty('aps-environment');
      expect(entitlements?.['keychain-access-groups']).toEqual(['test']);
    },
  );

  it('still sets the camera purpose string in personal-team mode', async () => {
    const config = await compileModsAsync(
      withLumenCapture(
        { name: 'Lumen', slug: 'lumen-test', _internal: { projectRoot } },
        { personalTeam: true },
      ),
      { projectRoot, introspect: true, platforms: ['ios'] },
    );
    expect(config.ios?.infoPlist?.NSCameraUsageDescription).toMatch(/^Lumen uses your camera/);
  });
});
