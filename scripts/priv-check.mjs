import fs from 'node:fs';
import path from 'node:path';

// PRIV-1: release builds must make no network requests during a reading. The only network code allowed
// is the development-build capture sender, which must live under src/dev/ and be guarded by __DEV__.
// Native code (the capture module now, Track F's widget targets later) may make no network calls at all:
// the Polar strap and the capture sender both run in JS.
const ROOTS = [
  'apps/mobile/src',
  'apps/mobile/app',
  'apps/mobile/modules',
  'apps/mobile/targets',
  'packages/core/src',
];
const DEV_DIR = path.normalize('apps/mobile/src/dev') + path.sep;
const SKIP = new Set(['node_modules', 'build', '.cxx', '.gradle', '.build', 'Pods']);
const SCRIPT = /\.(ts|tsx|js|jsx)$/;
const NATIVE = /\.(swift|m|mm|kt|java)$/;
const NETWORK = /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\baxios\b|\bEventSource\b/;
const NATIVE_NETWORK =
  /\bURLSession\b|\bNSURLConnection\b|\bNWConnection\b|\bCFStream|\bHttpURLConnection\b|\bHttpsURLConnection\b|\bokhttp3?\b|\bjava\.net\.(Socket|URL)\b|\bopenConnection\s*\(|\bio\.ktor\b|\bretrofit2?\b|\bcom\.android\.volley\b/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCRIPT.test(entry.name) || NATIVE.test(entry.name)) yield full;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    if (NATIVE.test(file)) {
      if (NATIVE_NETWORK.test(text)) violations.push(`${file}: native network call (none are allowed)`);
      continue;
    }
    const inDev = path.normalize(file).startsWith(DEV_DIR);
    if (NETWORK.test(text) && !inDev) violations.push(`${file}: network call outside ${DEV_DIR}`);
    if (inDev && NETWORK.test(text) && !/__DEV__/.test(text))
      violations.push(`${file}: network code without a __DEV__ guard`);
  }
}
if (violations.length) {
  console.error(`PRIV-1 failed:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('PRIV-1 OK: no network code outside development-only paths');
