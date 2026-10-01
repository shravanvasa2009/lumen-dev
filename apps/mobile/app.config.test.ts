/** @jest-environment node */
import type { ExpoConfig } from 'expo/config';

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

  it('ignores LUMEN_IOS_TEAM_ID unless personal-team mode is on', () => {
    expect(loadConfig({ LUMEN_IOS_TEAM_ID: 'ABCDE12345' })).toEqual(loadConfig({}));
  });

  it('switches iOS to the .dev bundle ID and the given team in personal-team mode', () => {
    const config = loadConfig({ LUMEN_IOS_PERSONAL_TEAM: '1', LUMEN_IOS_TEAM_ID: 'ABCDE12345' });
    expect(config.ios?.bundleIdentifier).toBe('io.github.shravanvasa2009.heartcheck.dev');
    expect(config.ios?.appleTeamId).toBe('ABCDE12345');
    expect(config.android?.package).toBe('io.github.shravanvasa2009.heartcheck');
    expect(config.plugins).toContainEqual(['./modules/lumen-capture/app.plugin', { personalTeam: true }]);
  });

  it.each([undefined, '', 'abcde12345', 'ABCDE1234'])(
    'refuses personal-team mode without a 10-character team ID (%p)',
    (teamId) => {
      const env = teamId === undefined ? {} : { LUMEN_IOS_TEAM_ID: teamId };
      expect(() => loadConfig({ LUMEN_IOS_PERSONAL_TEAM: '1', ...env })).toThrow(/LUMEN_IOS_TEAM_ID/);
    },
  );
});
