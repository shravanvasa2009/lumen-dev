import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot, npmScripts, readJsonIfExists, run } from '../lib/workspace.mjs';

// M3: all three models trained, exported, parity-checked, externally tested once, and documented.
const CARD_SECTIONS = ['## Intended use', '## Data', '## External test', '## Limitations'];

export default function proveM3() {
  const root = findRepoRoot();
  const models = path.join(root, 'models');
  const manifest = readJsonIfExists(path.join(models, 'manifest.json'));
  if (!manifest) return { status: 'FAIL', reasons: ['models/manifest.json not found'] };
  const reasons = [];
  for (const name of ['rhythm-net', 'sqi-finger', 'diabetes-net']) {
    const entry = manifest.models?.find((model) => model.name === name);
    if (!entry) { reasons.push(`manifest has no ${name}`); continue; }
    const file = path.join(models, entry.file);
    if (!fs.existsSync(file)) { reasons.push(`${entry.file} missing`); continue; }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (digest !== entry.sha256) reasons.push(`${entry.file} sha256 does not match the manifest`);
    const card = path.join(models, entry.card ?? '');
    if (!entry.card || !fs.existsSync(card)) reasons.push(`${name} model card missing`);
    else CARD_SECTIONS.filter((heading) => !fs.readFileSync(card, 'utf8').includes(heading)).forEach((heading) => reasons.push(`${entry.card} lacks "${heading}"`));
  }
  const parity = readJsonIfExists(path.join(models, 'parity.json'));
  if (!(parity?.maxAbsDiff <= 1e-4)) reasons.push(`ONNX parity ${parity?.maxAbsDiff ?? 'missing'}; need ≤ 1e-4 (ML-3)`);
  const external = readJsonIfExists(path.join(models, 'external-test.json'));
  const rhythm = external?.rhythm ?? {};
  for (const field of ['sensitivity', 'specificity', 'auroc', 'ci95', 'ppvNpv']) if (rhythm[field] == null) reasons.push(`external test lacks rhythm.${field} (ML-1)`);
  if (!(external?.sqi?.rhythmBiasGapPts <= 5)) reasons.push(`SQI rhythm-bias gap ${external?.sqi?.rhythmBiasGapPts ?? 'missing'}; need ≤ 5 points (ML-4)`);
  const diabetes = external?.diabetes ?? {};
  for (const field of ['auroc', 'sensitivity', 'specificity', 'ci95', 'ppvNpv', 'floorMet']) if (diabetes[field] == null) reasons.push(`external test lacks diabetes.${field} (ML-6)`);
  if (diabetes.floorMet === true && !(diabetes.auroc >= 0.75 && diabetes.specificity >= 0.85 && diabetes.sensitivity >= 0.6)) reasons.push('diabetes.floorMet is true but the numbers are below the ML-6 floor');
  if (!npmScripts(root)['test:fallback']) reasons.push('npm script "test:fallback" is not defined yet');
  else if (run('npm', ['run', 'test:fallback'], { cwd: root }).code !== 0) reasons.push('fallback tests failed');
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
