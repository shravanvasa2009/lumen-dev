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

test('the OpenFreeMap tile host is allowed in the Care map routes only', (t) => {
  const style = "const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';\n";
  const allowed = runOn(t, {
    'apps/mobile/app/care-map.tsx': style,
    'apps/mobile/app/(tabs)/care.tsx': style,
    'apps/mobile/src/care/CareMapView.tsx': style,
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  for (const file of [
    'apps/mobile/app/measure.tsx',
    'apps/mobile/src/measure/Screen.tsx',
    'apps/mobile/src/dev/sendCapture.ts',
    'packages/core/src/session.ts',
  ]) {
    const run = runOn(t, { [file]: style });
    assert.equal(run.status, 1, file);
    assert.match(run.stderr, /map tile host outside the Care map routes/, file);
  }
});

test('only the exact Care map route files are allowed, not look-alike paths', (t) => {
  const style = "const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';\n";
  const lookAlikes = [
    'apps/mobile/app/care-map.tsx.ts',
    'apps/mobile/app/care-map.tsx/x.ts',
    'apps/mobile/app/(tabs)/care-other.tsx',
    'apps/mobile/app/care.tsx',
    'apps/mobile/app/(tabs)/care.tsx.ts',
    'apps/mobile/app/(tabs)/care.tsx/x.ts',
  ];
  for (const file of lookAlikes) {
    const run = runOn(t, { [file]: style });
    assert.equal(run.status, 1, file);
    assert.match(run.stderr, /map tile host outside/, file);
  }
});

test('the map library and care code may be imported only inside the Care map paths', (t) => {
  const allowed = runOn(t, {
    'apps/mobile/app/care-map.tsx': "import { CareMapScreen } from '@/care/CareMapScreen';\n",
    'apps/mobile/app/(tabs)/care.tsx': "import { CareMapScreen } from '@/care/CareMapScreen';\n",
    'apps/mobile/src/care/CareMapView.tsx': "import { Map } from '@maplibre/maplibre-react-native';\n",
    'apps/mobile/src/care/CareMapScreen.tsx': "import { CareMapView } from './CareMapView';\n",
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  const forms = {
    'apps/mobile/app/measure.tsx': "import { CareMapScreen } from '@/care/CareMapScreen';\n",
    'apps/mobile/src/measure/Screen.tsx': "import { Map } from '@maplibre/maplibre-react-native';\n",
    'apps/mobile/src/results/Card.tsx': "import { clinics } from '../care/clinics';\n",
    'apps/mobile/src/results/Dyn.tsx': "const care = await import('../care');\n",
    'apps/mobile/src/results/Req.tsx': "const lib = require('@maplibre/maplibre-react-native/lib');\n",
    'apps/mobile/app/care.tsx': "export { x } from '@/care/clinics';\n",
    'apps/mobile/app/open-map.tsx': "import CareMap from './care-map';\n",
    'apps/mobile/app/open-map-ext.tsx': "import CareMap from './care-map.tsx';\n",
    'apps/mobile/app/(tabs)/care-other.tsx': "import { CareMapScreen } from '@/care/CareMapScreen';\n",
    'apps/mobile/app/(tabs)/other.tsx': "import Care from './care';\n",
    'apps/mobile/src/results/Template.tsx': 'const care = await import(`@/care/x`);\n',
  };
  for (const [file, contents] of Object.entries(forms)) {
    const run = runOn(t, { [file]: contents });
    assert.equal(run.status, 1, file);
    assert.match(run.stderr, /imports the map library or care code/, file);
  }
  const unrelated = runOn(t, {
    'apps/mobile/src/results/Card.tsx': "import { caregiver } from './caregiver';\n",
  });
  assert.equal(unrelated.status, 0, unrelated.stderr);
});
