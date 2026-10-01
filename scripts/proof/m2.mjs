import path from 'node:path';
import { findRepoRoot, readJsonIfExists } from '../lib/workspace.mjs';

// M2: the quality gate and measurement work on the iPhone, judged against the Polar strap.
export default function proveM2() {
  const metrics = readJsonIfExists(path.join(findRepoRoot(), 'docs', 'validation', 'metrics.json'));
  if (!metrics) return { status: 'FAIL', reasons: ['docs/validation/metrics.json not found; run npm run eval:replay'] };
  const reasons = [];
  if (!(metrics.polarPairedCaptures >= 5)) reasons.push(`Polar-paired captures: ${metrics.polarPairedCaptures ?? 0}; need ≥ 5`);
  if (!(metrics.hr?.maeBpm <= 5)) reasons.push(`HR MAE ${metrics.hr?.maeBpm ?? 'missing'} bpm; need ≤ 5`);
  const artifacts = metrics.artifactCaptures ?? {};
  if (!(artifacts.total >= 3)) reasons.push(`deliberate-artifact captures: ${artifacts.total ?? 0}; need ≥ 3`);
  else if (artifacts.rejectedOrInconclusive !== artifacts.total) reasons.push(`${artifacts.total - artifacts.rejectedOrInconclusive} artifact capture(s) were not rejected`);
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
