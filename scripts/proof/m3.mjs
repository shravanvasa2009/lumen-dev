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
  const parity = readJsonIfExists(path.join(models, 'parity.json'));
  if (!(parity?.maxAbsDiff <= 1e-4))
    reasons.push(`ONNX parity ${parity?.maxAbsDiff ?? 'missing'}; need ≤ 1e-4 (ML-3)`);
  // ADR 0031: the manifest marks which model ships in each family, so the proof checks that entry by flag.
  for (const family of ['rhythm', 'sqi', 'diabetes']) {
    const shipped = (manifest.models ?? []).filter(
      (model) => model.family === family && model.ships === true,
    );
    if (shipped.length !== 1) {
      reasons.push(`manifest has ${shipped.length} shipped ${family} models; need exactly 1`);
      continue;
    }
    const [entry] = shipped;
    const file = path.join(models, entry.file);
    if (!fs.existsSync(file)) {
      reasons.push(`${entry.file} missing`);
      continue;
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (digest !== entry.sha256) reasons.push(`${entry.file} sha256 does not match the manifest`);
    // The parity run must have tested this exact file, not an earlier export.
    if (parity?.models?.[entry.name]?.onnxSha256 !== entry.sha256)
      reasons.push(`parity.json was not run on the shipped ${entry.name} (onnxSha256 differs or missing)`);
    const card = path.join(models, entry.card ?? '');
    if (!entry.card || !fs.existsSync(card)) reasons.push(`${entry.name} model card missing`);
    else
      CARD_SECTIONS.filter((heading) => !fs.readFileSync(card, 'utf8').includes(heading)).forEach((heading) =>
        reasons.push(`${entry.card} lacks "${heading}"`),
      );
  }
  reasons.push(...externalTestReasons(readJsonIfExists(path.join(models, 'external-test.json'))));
  if (!npmScripts(root)['test:fallback']) reasons.push('npm script "test:fallback" is not defined yet');
  else if (run('npm', ['run', 'test:fallback'], { cwd: root }).code !== 0)
    reasons.push('fallback tests failed');
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}

export function externalTestReasons(external) {
  const reasons = [];
  const rhythm = external?.rhythm ?? {};
  for (const field of ['sensitivity', 'specificity', 'auroc', 'ci95', 'ppvNpv'])
    if (rhythm[field] == null) reasons.push(`external test lacks rhythm.${field} (ML-1)`);
  // ADR 0028: the gap is signed, acceptance(non-AF) − acceptance(AF); null means too few windows to judge.
  const gap = external?.sqi?.rhythmBiasGapPts;
  if (!(Number.isFinite(gap) && Math.abs(gap) <= 5))
    reasons.push(`SQI rhythm-bias gap ${gap ?? 'missing'}; need |gap| ≤ 5 points (ML-4)`);
  if (external?.sqi?.passed !== true) reasons.push('external test sqi.passed is not true (ML-4)');
  const diabetes = external?.diabetes ?? {};
  for (const field of ['auroc', 'sensitivity', 'specificity', 'ci95', 'ppvNpv', 'floorMet'])
    if (diabetes[field] == null) reasons.push(`external test lacks diabetes.${field} (ML-6)`);
  if (
    diabetes.floorMet === true &&
    !(diabetes.auroc >= 0.75 && diabetes.specificity >= 0.85 && diabetes.sensitivity >= 0.6)
  )
    reasons.push('diabetes.floorMet is true but the numbers are below the ML-6 floor');
  return reasons;
}
