import fs from 'node:fs';
import path from 'node:path';

// Covers what ESLint cannot see: generic names and silent excepts in Python (ruff also checks the
// latter), plus a warning-only heuristic for comments that restate the next line of code.
const GENERIC = /^\s*(data|result|res|tmp|temp|obj|val|info|stuff|thing|foo|bar)\s*=/;
const errors = [];
const warnings = [];

function* walk(dir, ext) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.venv', 'data', 'runs', '__pycache__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, ext);
    else if (ext.test(entry.name)) yield full;
  }
}

const words = (text) => (text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
function restates(comment, code) {
  const commentWords = words(comment);
  if (commentWords.length < 3) return false;
  const codeWords = new Set(words(code.replace(/([a-z])([A-Z])/g, '$1 $2')));
  return commentWords.filter((w) => codeWords.has(w)).length / commentWords.length >= 0.7;
}

for (const file of walk('ml', /\.py$/)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (GENERIC.test(line)) errors.push(`${file}:${i + 1}: generic name in "${line.trim()}"`);
    if (/^\s*except\b.*:\s*$/.test(line) && /^\s*pass\s*$/.test(lines[i + 1] ?? '')) errors.push(`${file}:${i + 1}: except block that silently passes`);
    const comment = line.match(/^\s*#\s*(.+)$/);
    if (comment && restates(comment[1], lines[i + 1] ?? '')) warnings.push(`${file}:${i + 1}: comment may restate the code`);
  });
}
for (const root of ['apps', 'packages', 'tools']) {
  for (const file of walk(root, /\.(ts|tsx)$/)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const comment = line.match(/^\s*\/\/\s*(.+)$/);
      if (comment && restates(comment[1], lines[i + 1] ?? '')) warnings.push(`${file}:${i + 1}: comment may restate the code`);
    });
  }
}
warnings.forEach((warning) => console.log(`warning: ${warning}`));
if (errors.length) {
  console.error(`Style check failed:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log(`style OK (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`);
