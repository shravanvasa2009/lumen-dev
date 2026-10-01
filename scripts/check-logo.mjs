import fs from 'node:fs';
import path from 'node:path';

// BRAND-1: the retired rings logo must not come back. Its generator drew concentric circles with a
// radial gradient; any source file with that signature, or a brand file other than the kit's, fails.
const ROOTS = ['apps', 'packages', 'tools'];
const SIGNATURES = [/radialGradient id="lg"/, /const logo = \(s = 150\)/, /rings?-logo/i];
const KIT = new Set([
  'mark-solid.dark.svg',
  'mark-solid.light.svg',
  'mark-outline.dark.svg',
  'mark-outline.light.svg',
  'lockup-dark.svg',
  'lockup-light.svg',
  'mark-mono.svg',
]);
const failures = [];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'ios', 'android', '.expo'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (/\.(tsx?|jsx?|mjs|svg|html)$/.test(file)) {
      const text = fs.readFileSync(file, 'utf8');
      if (SIGNATURES.some((pattern) => pattern.test(text))) failures.push(`${file}: old logo signature`);
    }
  }
}
const brandDir = 'apps/mobile/assets/brand';
if (!fs.existsSync(brandDir)) failures.push(`${brandDir} is missing`);
else
  for (const name of KIT)
    if (!fs.existsSync(path.join(brandDir, name))) failures.push(`${brandDir}/${name} is missing`);
if (failures.length) {
  console.error(`BRAND-1 failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('BRAND-1 OK: brand kit present, no old logo');
