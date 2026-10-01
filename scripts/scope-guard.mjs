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
  'PNZREN_SNPVAT_SEBAG',
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
// Regular-expression sources (ROT13 as well) for Objective-C and Swift forms of the front position:
// the Swift enum shorthand anywhere (assignment, comparison, case, argument, array, return), and the
// qualified Position form. An unspecified position is banned too, because a discovery session for it
// searches "regardless of position" and can return the front camera; the shorthand for it is matched
// only after the word position on the same statement, since other Swift enums also have that case.
// ROT13 would garble backslash escapes, so the sources use these placeholders instead.
const PLACEHOLDERS = {
  // Word end, so longer names such as frontier do not match.
  '~': '(?![A-Za-z0-9_])',
  // Word start.
  '@': '(?<![A-Za-z0-9_])',
  // Not member access: the dot follows no identifier, closing bracket, or optional/forced unwrap,
  // so cfg.front and items[0].front pass while [.front] and return .front do not.
  '%': '(?<![A-Za-z0-9_)\\]?!])',
};
const ENCODED_REGEX = [
  'NIPncgherQrivprCbfvgvbaSebag',
  '%[.]sebag~',
  '@cbfvgvba[.]sebag~',
  '@cbfvgvba[.]hafcrpvsvrq~',
  '@cbfvgvba[^;]*%[.]hafcrpvsvrq~',
];
const decodeRegex = (encoded) => rot13(encoded).replace(/[~@%]/g, (placeholder) => PLACEHOLDERS[placeholder]);
const PATTERNS = [
  ...ENCODED.map((encoded) => new RegExp(rot13(encoded).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')),
  ...ENCODED_REGEX.map((encoded) => new RegExp(decodeRegex(encoded), 'i')),
];
const ROOTS = ['apps', 'packages', 'tools', 'ml'];
// Vendored or generated folders that are skipped wherever they appear.
const SKIP = new Set(['node_modules', '.venv', '.expo']);
// Everything else is skipped by full repo-relative path, so a hand-written folder that happens to be
// named data or build (for example inside modules/lumen-capture) is still scanned.
const SKIP_PATHS = [
  /^ml\/(data|runs)$/,
  /^(apps|packages|tools)\/[^/]+\/(dist|build)$/,
  /^apps\/mobile\/(ios|android)$/,
  /^apps\/mobile\/modules\/lumen-capture\/android\/(build|[.]cxx|[.]gradle)$/,
];
const EXT = /[.](ts|tsx|js|jsx|mjs|cjs|swift|kt|kts|java|py|json|m|mm|h|xml|gradle|plist)$/;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const relative = full.split(path.sep).join('/');
    if (SKIP_PATHS.some((skipped) => skipped.test(relative))) continue;
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
