import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot, findWorkspace, run } from '../lib/workspace.mjs';

// M4d: widgets, lock-screen widgets, and the standing-test live timer verified on the iPhone by the
// owner, plus the static copy check.
export default function proveM4d() {
  const reasons = [];
  const ws = findWorkspace();
  const log =
    ws && fs.existsSync(path.join(ws, 'docs', 'device-tests.md'))
      ? fs.readFileSync(path.join(ws, 'docs', 'device-tests.md'), 'utf8')
      : '';
  for (const id of ['WID-1', 'WID-2', 'LIVE-1'])
    if (!new RegExp(`${id} confirmed`, 'i').test(log))
      reasons.push(`owner has not written "${id} confirmed" in docs/device-tests.md`);
  const copy = run(process.execPath, ['scripts/check-notification-copy.mjs'], {
    cwd: findRepoRoot(),
    shell: false,
  });
  if (copy.code !== 0) reasons.push(copy.stderr.trim());
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
