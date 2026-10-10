/** @jest-environment node */

// The app tsconfig has no Node types, so the Node modules this test needs are typed here.
const fs = jest.requireActual<{
  readFileSync(file: string, encoding: 'utf8'): string;
  readdirSync(dir: string): string[];
}>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string; dirname(file: string): string }>('path');

function moduleDir(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('Jest did not report this test file path');
  return path.dirname(testPath);
}

const targetDir = () => path.join(moduleDir(), '..', '..', 'targets', 'widget');

function swiftFiles(dir: string): { file: string; text: string }[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.swift'))
    .map((name) => ({ file: name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

describe('iOS widget Swift sources (WID-1, WID-2, LIVE-1)', () => {
  // ActivityKit pairs the Live Activity the app starts with the extension's UI through
  // StandingActivityAttributes, and both sides read the snapshot with WidgetContent (ADR 0005).
  it('keep LumenShared.swift identical in the lumen-widgets module and the widget target', () => {
    const inModule = fs.readFileSync(path.join(moduleDir(), 'ios', 'LumenShared.swift'), 'utf8');
    const inTarget = fs.readFileSync(path.join(targetDir(), 'LumenShared.swift'), 'utf8');
    expect(inModule).toBe(inTarget);
  });

  // All copy comes from widgetDisplay and lockscreen.json, so check-notification-copy.mjs sees everything
  // the lock screen can show and the widgets follow the app's language.
  it('draw no text written in Swift', () => {
    const files = [...swiftFiles(targetDir()), ...swiftFiles(path.join(moduleDir(), 'ios'))];
    expect(files.length).toBeGreaterThan(0);
    const literalText = files.filter(({ text }) => /\b(Text|Label)\(\s*"/.test(text)).map(({ file }) => file);
    expect(literalText).toEqual([]);
  });

  it('open only the three lumen:// links that +native-intent.tsx maps (spec §9.6)', () => {
    const links = swiftFiles(targetDir()).flatMap(({ text }) => text.match(/lumen:\/\/[^"]*/g) ?? []);
    expect(new Set(links)).toEqual(new Set(['lumen://check', 'lumen://check?mode=full', 'lumen://standing']));
  });
});
