import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../lib/workspace.mjs';

const milestone = (process.argv[2] ?? '').toLowerCase();
if (!/^(m[0-6]|m4d)$/.test(milestone)) {
  console.error('Usage: npm run proof -- m0   (m0 … m6, m4d)');
  process.exit(2);
}
const { default: prove } = await import(`./${milestone}.mjs`);
const verdict = prove();
const root = findRepoRoot();
const store = path.join(root, '.proof', 'results.json');
fs.mkdirSync(path.dirname(store), { recursive: true });
const history = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : {};
history[milestone] = { ...verdict, at: new Date().toISOString() };
fs.writeFileSync(store, JSON.stringify(history, null, 2));
console.log(`${milestone.toUpperCase()}: ${verdict.status}`);
verdict.reasons.forEach((reason) => console.log(`  - ${reason}`));
process.exit(verdict.status === 'PASS' ? 0 : 1);
