import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot, findWorkspace, run } from '../lib/workspace.mjs';

// M6: release builds exist, the privacy check passes, and 20 release readings ran without a crash.
function finishedBuilds(platform, root) {
  // VERIFY: eas-cli build:list flags against the current EAS CLI docs.
  const list = run(
    'npx',
    [
      'eas-cli',
      'build:list',
      '--platform',
      platform,
      '--status',
      'finished',
      '--limit',
      '10',
      '--json',
      '--non-interactive',
    ],
    { cwd: path.join(root, 'apps', 'mobile') },
  );
  if (list.code !== 0) return { error: (list.stderr || list.stdout).trim().split('\n').at(-1) };
  return { builds: JSON.parse(list.stdout || '[]') };
}

export default function proveM6() {
  const root = findRepoRoot();
  const reasons = [];
  const ios = finishedBuilds('ios', root);
  if (ios.error) reasons.push(`EAS iOS build list failed: ${ios.error}`);
  else if (!ios.builds.some((build) => build.buildProfile === 'production'))
    reasons.push('no finished production iOS build');
  const android = finishedBuilds('android', root);
  if (android.error) reasons.push(`EAS Android build list failed: ${android.error}`);
  else if (!android.builds.length) reasons.push('no finished Android build (APK)');
  const priv = run(process.execPath, ['scripts/priv-check.mjs'], { cwd: root, shell: false });
  if (priv.code !== 0) reasons.push(priv.stderr.trim());
  const ws = findWorkspace();
  const log = ws ? fs.readFileSync(path.join(ws, 'docs', 'device-tests.md'), 'utf8') : '';
  const releaseOk = log
    .split(/\r?\n/)
    .filter((line) => /\|\s*REL\s*\|/.test(line) && /\|\s*ok\s*\|/i.test(line)).length;
  if (releaseOk < 20)
    reasons.push(`${releaseOk} release readings logged as ok in docs/device-tests.md; need 20 (REL-1)`);
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
