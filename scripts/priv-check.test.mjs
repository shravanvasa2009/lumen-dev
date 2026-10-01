import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const check = path.join(path.dirname(fileURLToPath(import.meta.url)), 'priv-check.mjs');

// Runs the check in a throwaway repo holding only the given files (repo-relative path → contents).
function runOn(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'priv-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return spawnSync(process.execPath, [check], { cwd: root, encoding: 'utf8' });
}

const SENDER = "if (!__DEV__) throw new Error('dev only');\nawait fetch(url);\n";

test('the guarded capture sender under src/dev passes', (t) => {
  assert.equal(runOn(t, { 'apps/mobile/src/dev/sendCapture.ts': SENDER }).status, 0);
});

test('network code outside src/dev, or without __DEV__, fails', (t) => {
  const outside = runOn(t, { 'apps/mobile/app/measure.tsx': 'await fetch(url);\n' });
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /measure\.tsx: network call outside/);
  const unguarded = runOn(t, { 'apps/mobile/src/dev/sendCapture.ts': 'await fetch(url);\n' });
  assert.match(unguarded.stderr, /without a __DEV__ guard/);
});

test('the capture module, core, and widget targets are scanned too', (t) => {
  for (const file of [
    'apps/mobile/modules/lumen-capture/src/index.ts',
    'packages/core/src/session.ts',
    'apps/mobile/targets/widget/index.ts',
  ]) {
    const run = runOn(t, { [file]: 'new WebSocket(url);\n' });
    assert.equal(run.status, 1, file);
  }
});

test('native network APIs fail in the module and in widget targets', (t) => {
  const forms = {
    'apps/mobile/modules/lumen-capture/ios/Upload.swift':
      'let task = URLSession.shared.dataTask(with: url)\n',
    'apps/mobile/modules/lumen-capture/ios/Legacy.m': '[NSURLConnection sendSynchronousRequest:request];\n',
    'apps/mobile/modules/lumen-capture/android/src/main/java/Upload.kt':
      'val connection = URL(url).openConnection() as HttpURLConnection\n',
    'apps/mobile/modules/lumen-capture/android/src/main/java/Client.kt': 'import okhttp3.OkHttpClient\n',
    'apps/mobile/targets/widget/Timeline.swift':
      'let connection = NWConnection(host: host, port: port, using: .tcp)\n',
  };
  for (const [file, contents] of Object.entries(forms)) {
    const run = runOn(t, { [file]: contents });
    assert.equal(run.status, 1, file);
    assert.match(run.stderr, /native network call/);
  }
});

test('native camera code and generated build folders pass', (t) => {
  const run = runOn(t, {
    'apps/mobile/modules/lumen-capture/ios/CaptureSession.swift': 'let session = AVCaptureSession()\n',
    'apps/mobile/modules/lumen-capture/android/build/generated/Fetch.kt': 'import okhttp3.OkHttpClient\n',
    'apps/mobile/node_modules/lib/index.js': 'fetch(url);\n',
  });
  assert.equal(run.status, 0, run.stderr);
});
