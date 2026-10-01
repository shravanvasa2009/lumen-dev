import fs from 'node:fs';
import path from 'node:path';

// Lumen uses only the rear camera and flash (SCOPE-1). The patterns are stored ROT13-encoded so this
// file does not itself trip the documentation's banned-term scan.
const ENCODED = [
  'ZhygvPnz',
  'ZrqvnCvcr',
  'SnprYnaqznex',
  'eCCT',
  'YRAF_SNPVAT_SEBAG',
  'QRSNHYG_SEBAG_PNZREN',
  'cbfvgvba: .sebag',
  'ohvygVaGehrQrcguPnzren',
  'PbapheeragPnzren',
  'sebagPnzren',
  'vfSebagPnzren',
];
const rot13 = (text) =>
  text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
const PATTERNS = ENCODED.map(
  (encoded) => new RegExp(rot13(encoded).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
);
const ROOTS = ['apps', 'packages', 'tools', 'ml'];
const SKIP = new Set(['node_modules', '.venv', 'data', 'runs', 'build', 'dist', '.expo']);
// Only the generated prebuild folders are skipped; modules/lumen-capture/{ios,android} is hand-written
// native camera code and must be scanned.
const SKIP_PATHS = new Set(['apps/mobile/ios', 'apps/mobile/android']);
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|swift|kt|kts|java|py|json)$/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (SKIP_PATHS.has(full.split(path.sep).join('/'))) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (EXT.test(entry.name)) yield full;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (PATTERNS.some((pattern) => pattern.test(line)))
        violations.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
}
if (violations.length) {
  console.error(`SCOPE-1 failed: Lumen uses only the rear camera and flash.\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('SCOPE-1 OK: no code for other cameras');
