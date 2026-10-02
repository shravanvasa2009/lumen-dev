/** @jest-environment node */
import type { ExpoConfig } from 'expo/config';
import { getConfig } from 'expo/config';
import { AndroidConfig, compileModsAsync } from 'expo/config-plugins';

const ENV_KEYS = ['LUMEN_IOS_PERSONAL_TEAM', 'LUMEN_IOS_TEAM_ID'] as const;

// app.config.ts reads the environment once at import, so each case imports a fresh copy.
function loadConfig(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): ExpoConfig {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      config = jest.requireActual<{ default: ExpoConfig }>('./app.config').default;
    });
    if (!config) {
      throw new Error('app.config.ts has no default export');
    }
    return config;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('app.config personal-team mode (BOOT)', () => {
  it('uses the real bundle ID, no team, and the plain plugin entry by default', () => {
    const config = loadConfig({});
    expect(config.ios?.bundleIdentifier).toBe('io.github.shravanvasa2009.heartcheck');
    expect(config.ios).not.toHaveProperty('appleTeamId');
    expect(config.plugins).toContain('./modules/lumen-capture/app.plugin');
  });

  // Without it, prebuild leaves the Glance receivers out of the manifest and the picker has no widgets.
  it('lists the Android widget plugin (WID-1)', () => {
    expect(loadConfig({}).plugins).toContain('./modules/lumen-widgets/app.plugin');
  });

  it('ignores LUMEN_IOS_TEAM_ID unless personal-team mode is on', () => {
    expect(loadConfig({ LUMEN_IOS_TEAM_ID: 'ABCDE12345' })).toEqual(loadConfig({}));
  });

  it('switches iOS to the .dev bundle ID and leaves the team to expo run:ios without a team ID', () => {
    for (const env of [{}, { LUMEN_IOS_TEAM_ID: '' }]) {
      const config = loadConfig({ LUMEN_IOS_PERSONAL_TEAM: '1', ...env });
      expect(config.ios?.bundleIdentifier).toBe('io.github.shravanvasa2009.heartcheck.dev');
      expect(config.ios).not.toHaveProperty('appleTeamId');
      expect(config.android?.package).toBe('io.github.shravanvasa2009.heartcheck');
      expect(config.plugins).toContainEqual(['./modules/lumen-capture/app.plugin', { personalTeam: true }]);
    }
  });

  it('also sets the given team in personal-team mode', () => {
    const config = loadConfig({ LUMEN_IOS_PERSONAL_TEAM: '1', LUMEN_IOS_TEAM_ID: 'ABCDE12345' });
    expect(config.ios?.bundleIdentifier).toBe('io.github.shravanvasa2009.heartcheck.dev');
    expect(config.ios?.appleTeamId).toBe('ABCDE12345');
    expect(config.plugins).toContainEqual(['./modules/lumen-capture/app.plugin', { personalTeam: true }]);
  });

  it.each(['abcde12345', 'ABCDE1234', 'ABCDE123456'])(
    'refuses a team ID that is not 10 capital letters and digits (%p)',
    (teamId) => {
      expect(() => loadConfig({ LUMEN_IOS_PERSONAL_TEAM: '1', LUMEN_IOS_TEAM_ID: teamId })).toThrow(
        /LUMEN_IOS_TEAM_ID/,
      );
    },
  );

  it.each(['', '0'])('treats LUMEN_IOS_PERSONAL_TEAM=%p as off', (flag) => {
    expect(loadConfig({ LUMEN_IOS_PERSONAL_TEAM: flag })).toEqual(loadConfig({}));
  });

  it.each(['true', 'yes', '2', ' 1'])('refuses any other LUMEN_IOS_PERSONAL_TEAM value (%p)', (flag) => {
    expect(() => loadConfig({ LUMEN_IOS_PERSONAL_TEAM: flag })).toThrow(/LUMEN_IOS_PERSONAL_TEAM/);
  });
});

describe('app.config widgets and the standing-test Live Activity (WID-1, LIVE-1)', () => {
  it.each([
    [{}, 'group.io.github.shravanvasa2009.heartcheck'],
    [{ LUMEN_IOS_PERSONAL_TEAM: '1' }, 'group.io.github.shravanvasa2009.heartcheck.dev'],
  ])('gives each bundle ID its own App Group (%p)', (env, appGroup) => {
    expect(loadConfig(env).ios?.entitlements).toEqual({
      'com.apple.security.application-groups': [appGroup],
    });
  });

  it('builds the widget target and the widget module on both platforms', () => {
    const { plugins } = loadConfig({});
    expect(plugins).toContain('@bacons/apple-targets');
    expect(plugins).toContain('./modules/lumen-widgets/app.plugin');
  });
});

describe('app.config Bluetooth for the Lab chest strap', () => {
  it('uses the spec §9.5 purpose string and never asks for location on Android 12+', () => {
    expect(loadConfig({}).plugins).toContainEqual([
      'react-native-ble-plx',
      {
        isBackgroundEnabled: false,
        neverForLocation: true,
        bluetoothAlwaysPermission: 'Used only in Lab mode to compare Lumen with a heart-rate chest strap.',
      },
    ]);
  });
});

describe('app.config Care map location (ADR 0054)', () => {
  // Jest runs from apps/mobile, where app.config.ts lives.
  const projectRoot = process.cwd();
  let evaluated: ExpoConfig;
  let androidManifest: {
    manifest: { 'uses-permission'?: { $: { 'android:name': string; 'tools:node'?: string } }[] };
  };

  // Runs every plugin in app.config.ts against Expo's templates, in memory, as a prebuild would. Prebuild
  // itself turns android.blockedPermissions into manifest entries, so that step is applied here too.
  beforeAll(async () => {
    const { exp } = getConfig(projectRoot, {
      skipSDKVersionRequirement: true,
      isPublicConfig: false,
      isModdedConfig: true,
    });
    evaluated = await compileModsAsync(AndroidConfig.Permissions.withInternalBlockedPermissions(exp), {
      projectRoot,
      introspect: true,
      platforms: ['ios', 'android'],
    });
    androidManifest = evaluated._internal?.modResults.android.manifest;
  }, 60_000);

  it('gives the iOS location prompt in English and Spanish', () => {
    expect(evaluated.ios?.infoPlist?.NSLocationWhenInUseUsageDescription).toMatch(
      /^Lumen uses your location/,
    );
    expect(evaluated.locales?.es).toMatchObject({
      ios: {
        NSLocationWhenInUseUsageDescription: expect.stringMatching(/^Lumen usa tu ubicación/),
        NSCameraUsageDescription: expect.stringMatching(/^Lumen usa la cámara/),
      },
    });
  });

  it('asks for no Always, motion or background location on iOS', () => {
    const keys = Object.keys(evaluated.ios?.infoPlist ?? {});
    expect(keys.filter((key) => key.startsWith('NSLocationAlways'))).toEqual([]);
    expect(keys).not.toContain('NSMotionUsageDescription');
    expect(evaluated.ios?.infoPlist?.UIBackgroundModes ?? []).not.toContain('location');
  });

  it('keeps coarse location on Android and blocks the precise one', () => {
    const kept = (androidManifest.manifest['uses-permission'] ?? [])
      .filter((entry) => entry.$['tools:node'] !== 'remove')
      .map((entry) => entry.$['android:name']);
    expect(kept).toContain('android.permission.ACCESS_COARSE_LOCATION');
    expect(kept).not.toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(kept).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
  });
});
