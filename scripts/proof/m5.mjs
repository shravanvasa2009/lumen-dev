import path from 'node:path';
import { findRepoRoot, readJsonIfExists } from '../lib/workspace.mjs';

// M5: validation evidence exists, is dated and tied to a commit, and was independently recomputed.
export default function proveM5() {
  const dir = path.join(findRepoRoot(), 'docs', 'validation');
  const evidence = readJsonIfExists(path.join(dir, 'evidence.json'));
  const metrics = readJsonIfExists(path.join(dir, 'metrics.json'));
  const reasons = [];
  if (!evidence) reasons.push('docs/validation/evidence.json not found');
  else {
    if (!evidence.commit || !evidence.date) reasons.push('evidence.json needs a commit and a date');
    const hr = evidence.metrics?.hr ?? {};
    if (!(hr.people >= 10)) reasons.push(`HR evidence covers ${hr.people ?? 0} people; need ≥ 10 (DSP-A)`);
    for (const key of ['hr', 'rhythm', 'hrv', 'resp']) {
      const entry = evidence.metrics?.[key];
      if (!entry) reasons.push(`evidence.json lacks ${key}`);
      else if (entry.label !== 'experimental' && entry.ci95 == null && key !== 'resp')
        reasons.push(`${key} is labeled "${entry.label}" without a confidence interval`);
    }
  }
  if (!metrics) reasons.push('docs/validation/metrics.json not found');
  else {
    if (!metrics.perTier?.some((row) => row.phones > 0))
      reasons.push('per-tier error table is empty (COMP-2)');
    if (metrics.recompute?.matches !== true) reasons.push('independent recompute has not matched (VER-1)');
    if (metrics.ux1?.firstReadings == null) reasons.push('UX-1 not measured');
    if (metrics.ml5?.sinusReadings == null) reasons.push('ML-5 not measured');
  }
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
