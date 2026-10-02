import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// PRIV-1: release builds must make no network requests during a reading. The only network code allowed
// is the development-build capture sender, which must live under src/dev/ and be guarded by __DEV__.
// Native code (the capture module now, Track F's widget targets later) may make no network calls at all:
// the Polar strap and the capture sender both run in JS.
const ROOTS = [
  'apps/mobile/src/',
  'apps/mobile/app/',
  'apps/mobile/modules/',
  'apps/mobile/targets/',
  'packages/core/src/',
];
const DEV_DIR = 'apps/mobile/src/dev/';
const SCRIPT = /\.(ts|tsx|js|jsx)$/;
const NATIVE = /\.(swift|m|mm|h|c|cc|cpp|kt|java)$/;
const NETWORK = /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\baxios\b|\bEventSource\b/;
// URLSession has no word boundaries so NSURLSession and URLSessionWebSocketTask match too. Library names
// match only as packages (okhttp3.…), so the words in a comment don't.
const NATIVE_NETWORK = new RegExp(
  [
    'URLSession',
    'NSURLConnection',
    '\\bNWConnection\\b',
    '\\bCFStream',
    '\\bjava\\.net\\.(Socket|URL|URLConnection|HttpURLConnection|\\*)',
    '\\bHttpsURLConnection\\b',
    '\\bopenConnection\\s*\\(',
    '\\bokhttp3?\\.',
    '\\bretrofit2?\\.',
    '\\bio\\.ktor\\.',
    '\\bcom\\.android\\.volley\\.',
    '\\bandroid\\.net\\.http\\.',
    '\\borg\\.chromium\\.net\\.',
  ].join('|'),
);
// ADR 0054: the Care map, opened only by the user, loads map tiles from OpenFreeMap. That host is allowed
// in the /care-map route and its screen code, and nowhere else (so never during a reading).
const TILE_HOST = /tiles\.openfreemap\.org/;
const CARE_MAP_PATHS = ['apps/mobile/app/care-map.tsx', 'apps/mobile/src/care/'];
const INTERNET_PERMISSION = /android\.permission\.INTERNET/;

// Tracked and not-ignored files, so a hand-written file can't hide under a folder name such as build.
// -z, because git otherwise quotes and escapes non-ASCII paths, and those would never match a root.
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter((file) => ROOTS.some((root) => file.startsWith(root)) && fs.existsSync(file));

const violations = [];
for (const file of files) {
  if (file.endsWith('AndroidManifest.xml')) {
    if (INTERNET_PERMISSION.test(fs.readFileSync(file, 'utf8')))
      violations.push(`${file}: declares the INTERNET permission`);
    continue;
  }
  const native = NATIVE.test(file);
  if (!native && !SCRIPT.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (native) {
    if (NATIVE_NETWORK.test(text)) violations.push(`${file}: native network call (none are allowed)`);
    continue;
  }
  if (TILE_HOST.test(text) && !CARE_MAP_PATHS.some((allowed) => file.startsWith(allowed)))
    violations.push(`${file}: map tile host outside the /care-map route`);
  const inDev = file.startsWith(DEV_DIR);
  if (NETWORK.test(text) && !inDev) violations.push(`${file}: network call outside ${DEV_DIR}`);
  if (inDev && NETWORK.test(text) && !/__DEV__/.test(text))
    violations.push(`${file}: network code without a __DEV__ guard`);
}
if (violations.length) {
  console.error(`PRIV-1 failed:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('PRIV-1 OK: no network code outside development-only paths');
