import fs from 'node:fs';
import path from 'node:path';

// PRIV-1: release builds must make no network requests during a reading. The only network code allowed
// is the development-build capture sender, which must live under src/dev/ and be guarded by __DEV__.
const ROOTS = ['apps/mobile/src', 'apps/mobile/app'];
const DEV_DIR = path.normalize('apps/mobile/src/dev') + path.sep;
const NETWORK = /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\baxios\b|\bEventSource\b/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) yield full;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    const inDev = path.normalize(file).startsWith(DEV_DIR);
    if (NETWORK.test(text) && !inDev) violations.push(`${file}: network call outside ${DEV_DIR}`);
    if (inDev && NETWORK.test(text) && !/__DEV__/.test(text)) violations.push(`${file}: network code without a __DEV__ guard`);
  }
}
if (violations.length) {
  console.error(`PRIV-1 failed:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('PRIV-1 OK: no network code outside development-only paths');
