import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// PRIV-1: release builds must make no network requests during a reading. The only network code allowed
// is the development-build capture sender, which must live under src/dev/ and be guarded by __DEV__,
// plus the user-opened Care map (ADR 0054), whose tile host and map library stay inside the Care map paths.
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
// ADR 0054: the Care map, opened only by the user, loads map tiles from OpenFreeMap. The host, the map
// library, and imports of the care code are allowed only in the Care tab route (ADR 0065) and src/care/, so no
// other screen (such as a reading) can reach them.
const TILE_HOST = /tiles\.openfreemap\.org/;
const CARE_TAB_ROUTE = 'apps/mobile/app/(tabs)/care.tsx';
const CARE_MAP_DIR = 'apps/mobile/src/care/';
const MAP_LIBRARY = '@maplibre/maplibre-react-native';
const IMPORT_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"`]([^'"`]+)['"`]/g;

function inCareMap(file) {
  return file === CARE_TAB_ROUTE || file.startsWith(CARE_MAP_DIR);
}

function importsCareMapCode(file, text) {
  return [...text.matchAll(IMPORT_SPECIFIER)].some(([, specifier]) => {
    if (specifier === MAP_LIBRARY || specifier.startsWith(`${MAP_LIBRARY}/`)) return true;
    if (specifier === '@/care' || specifier.startsWith('@/care/')) return true;
    if (!specifier.startsWith('.')) return false;
    const target = path.posix.join(path.posix.dirname(file), specifier);
    return (
      target === CARE_MAP_DIR.slice(0, -1) ||
      target.startsWith(CARE_MAP_DIR) ||
      target === CARE_TAB_ROUTE ||
      `${target}.tsx` === CARE_TAB_ROUTE
    );
  });
}

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
  if (!inCareMap(file)) {
    if (TILE_HOST.test(text))
      violations.push(`${file}: map tile host outside the Care map (Care tab, src/care)`);
    if (importsCareMapCode(file, text))
      violations.push(
        `${file}: imports the map library or care code outside the Care map (Care tab, src/care)`,
      );
  }
  const inDev = file.startsWith(DEV_DIR);
  if (NETWORK.test(text) && !inDev) violations.push(`${file}: network call outside ${DEV_DIR}`);
  if (inDev && NETWORK.test(text) && !/__DEV__/.test(text))
    violations.push(`${file}: network code without a __DEV__ guard`);
}
if (violations.length) {
  console.error(`PRIV-1 failed:\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('PRIV-1 OK: no network code outside development-only paths and the Care map');
