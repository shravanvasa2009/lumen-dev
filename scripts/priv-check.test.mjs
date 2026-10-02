import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const check = path.join(path.dirname(fileURLToPath(import.meta.url)), 'priv-check.mjs');

// Runs the check in a throwaway git repo holding only the given files (repo-relative path → contents).
// The check reads `git ls-files`, so untracked files count unless .gitignore excludes them.
function runOn(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'priv-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return spawnSync(process.execPath, [check], { cwd: root, encoding: 'utf8' });
}

const SENDER = "if (!__DEV__) throw new Error('dev only');\nawait fetch(url);\n";
const MODULE = 'apps/mobile/modules/lumen-capture';

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
    `${MODULE}/src/index.ts`,
    'packages/core/src/session.ts',
    'apps/mobile/targets/widget/index.ts',
  ]) {
    const run = runOn(t, { [file]: 'new WebSocket(url);\n' });
    assert.equal(run.status, 1, file);
  }
});

test('native network APIs fail in the module and in widget targets', (t) => {
  const forms = {
    [`${MODULE}/ios/Upload.swift`]: 'let task = URLSession.shared.dataTask(with: url)\n',
    [`${MODULE}/ios/Socket.swift`]: 'let socket: URLSessionWebSocketTask\n',
    [`${MODULE}/ios/Legacy.m`]: '[NSURLConnection sendSynchronousRequest:request];\n',
    [`${MODULE}/ios/Session.mm`]: 'NSURLSession *session = [NSURLSession sharedSession];\n',
    [`${MODULE}/android/src/main/java/Upload.kt`]:
      'val connection = URL(url).openConnection() as HttpURLConnection\n',
    [`${MODULE}/android/src/main/java/Wildcard.kt`]: 'import java.net.*\n',
    [`${MODULE}/android/src/main/java/Connection.java`]: 'import java.net.URLConnection;\n',
    [`${MODULE}/android/src/main/java/Client.kt`]: 'import okhttp3.OkHttpClient\n',
    [`${MODULE}/android/src/main/java/Engine.kt`]: 'import android.net.http.HttpEngine\n',
    [`${MODULE}/android/src/main/java/Cronet.kt`]: 'import org.chromium.net.CronetEngine\n',
    'apps/mobile/targets/widget/Timeline.swift':
      'let connection = NWConnection(host: host, port: port, using: .tcp)\n',
  };
  for (const [file, contents] of Object.entries(forms)) {
    const run = runOn(t, { [file]: contents });
    assert.equal(run.status, 1, file);
    assert.match(run.stderr, /native network call/, file);
  }
});

test('a module or widget manifest may not ask for the INTERNET permission', (t) => {
  const run = runOn(t, {
    [`${MODULE}/android/src/main/AndroidManifest.xml`]:
      '<manifest><uses-permission android:name="android.permission.INTERNET"/></manifest>\n',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /declares the INTERNET permission/);
});

test('hand-written files under build-like names are scanned; ignored ones are not', (t) => {
  const handWritten = runOn(t, { [`${MODULE}/ios/Pods/Upload.swift`]: 'URLSession.shared\n' });
  assert.equal(handWritten.status, 1);
  const ignored = runOn(t, {
    '.gitignore': 'build/\nnode_modules/\n',
    [`${MODULE}/android/build/generated/Fetch.kt`]: 'import okhttp3.OkHttpClient\n',
    'apps/mobile/node_modules/lib/index.js': 'fetch(url);\n',
    [`${MODULE}/ios/CaptureSession.swift`]: 'let session = AVCaptureSession()\n',
    [`${MODULE}/android/src/main/java/Notes.kt`]: '// We use no okhttp or retrofit here.\n',
  });
  assert.equal(ignored.status, 0, ignored.stderr);
});

test('a file with a non-ASCII name is scanned too', (t) => {
  const run = runOn(t, { 'apps/mobile/app/señal.tsx': 'await fetch(url);\n' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /señal\.tsx: network call outside/);
});
