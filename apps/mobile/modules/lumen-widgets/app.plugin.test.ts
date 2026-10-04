/** @jest-environment node */
import type { ExpoConfig } from 'expo/config';
import { AndroidConfig, compileModsAsync } from 'expo/config-plugins';

import withLumenWidgets from './app.plugin';

// The app tsconfig has no Node types, so the Node modules this test needs are typed here.
const fs = jest.requireActual<{
  mkdtempSync(prefix: string): string;
  rmSync(dir: string, options: { recursive: true; force: true }): void;
}>('fs');
const os = jest.requireActual<{ tmpdir(): string }>('os');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

const SMALL = 'expo.modules.lumenwidgets.SmallWidgetReceiver';
const MEDIUM = 'expo.modules.lumenwidgets.MediumWidgetReceiver';

// Introspection runs the AndroidManifest mods in memory, from Expo's template or from a manifest already
// in the project root (a second prebuild without --clean).
async function manifestAfter(projectRoot: string, applyTwice = false): Promise<AndroidManifest> {
  let config: ExpoConfig = {
    name: 'Lumen',
    slug: 'lumen-test',
    android: { package: 'test.lumen' },
    _internal: { projectRoot },
  };
  config = withLumenWidgets(config);
  if (applyTwice) {
    config = withLumenWidgets(config);
  }
  const compiled = await compileModsAsync(config, { projectRoot, introspect: true, platforms: ['android'] });
  return compiled._internal?.modResults.android.manifest;
}

function receiversIn(manifest: AndroidManifest) {
  return AndroidConfig.Manifest.getMainApplicationOrThrow(manifest).receiver ?? [];
}

// Expo's ManifestReceiver type leaves out meta-data, which the manifest writer still serializes.
type WidgetReceiver = ReturnType<typeof receiversIn>[number] & {
  'meta-data'?: { $: Record<string, string> }[];
};

function receiverNamed(manifest: AndroidManifest, name: string): WidgetReceiver[] {
  return receiversIn(manifest).filter((receiver) => receiver.$['android:name'] === name);
}

// The first compileModsAsync in a process loads and transforms Expo's config-plugin modules; lumen-capture's
// plugin test measured up to 12 s cold under the full suite, so this gets the same 30 s budget.
const COLD_INTROSPECTION_MS = 30_000;

describe('lumen-widgets config plugin (WID-1, PRIV-1)', () => {
  let projectRoot: string;
  let fromTemplate: AndroidManifest;

  beforeAll(async () => {
    const templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-widgets-'));
    fromTemplate = await manifestAfter(templateRoot);
    fs.rmSync(templateRoot, { recursive: true, force: true });
  }, COLD_INTROSPECTION_MS);

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-widgets-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it.each([
    [SMALL, '@xml/lumen_widget_small'],
    [MEDIUM, '@xml/lumen_widget_medium'],
  ])('registers %s with its widget provider file', (name, provider) => {
    const [receiver, ...extra] = receiverNamed(fromTemplate, name);
    expect(extra).toHaveLength(0);
    expect(receiver?.$['android:exported']).toBe('true');
    expect(receiver?.['intent-filter']?.[0]?.action?.[0]?.$['android:name']).toBe(
      'android.appwidget.action.APPWIDGET_UPDATE',
    );
    expect(receiver?.['meta-data']?.[0]?.$).toEqual({
      'android:name': 'android.appwidget.provider',
      'android:resource': provider,
    });
  });

  it("names the app in the picker preview with the app's own name (spec §2)", async () => {
    const compiled = await compileModsAsync(
      withLumenWidgets({
        name: 'Flicker',
        slug: 'lumen-test',
        android: { package: 'test.lumen' },
        _internal: { projectRoot },
      }),
      { projectRoot, introspect: true, platforms: ['android'] },
    );
    const strings = compiled._internal?.modResults.android.strings;
    expect(strings.resources.string).toContainEqual(
      expect.objectContaining({
        $: expect.objectContaining({ name: 'lumen_widget_preview_name' }),
        _: 'Flicker',
      }),
    );
  });

  // Only the config plugin: the Gradle manifest merge (Glance pulls in WorkManager) is checked on a build.
  it('the config plugin adds no permissions (PRIV-1)', async () => {
    const plain = await compileModsAsync(
      { name: 'Lumen', slug: 'lumen-test', android: { package: 'test.lumen' }, _internal: { projectRoot } },
      { projectRoot, introspect: true, platforms: ['android'] },
    );
    const before = plain._internal?.modResults.android.manifest.manifest['uses-permission'] ?? [];
    expect(fromTemplate.manifest['uses-permission'] ?? []).toEqual(before);
  });

  it('adds nothing twice when run again on its own output', async () => {
    await AndroidConfig.Manifest.writeAndroidManifestAsync(
      path.join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      await manifestAfter(projectRoot),
    );
    const manifest = await manifestAfter(projectRoot);
    expect(receiverNamed(manifest, SMALL)).toHaveLength(1);
    expect(receiverNamed(manifest, MEDIUM)).toHaveLength(1);
  });

  it('adds nothing twice when listed twice in the plugins', async () => {
    const manifest = await manifestAfter(projectRoot, true);
    expect(receiverNamed(manifest, SMALL)).toHaveLength(1);
    expect(receiverNamed(manifest, MEDIUM)).toHaveLength(1);
  });
});
