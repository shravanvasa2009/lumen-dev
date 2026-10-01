import { findRepoRoot, npmScripts, run } from '../lib/workspace.mjs';

// M4: the complete app (34 screens, light and dark, notifications), with CI green on main.
export default function proveM4() {
  const root = findRepoRoot();
  const reasons = [];
  const ci = run(
    'gh',
    ['run', 'list', '--branch', 'main', '--limit', '1', '--json', 'conclusion,workflowName'],
    { cwd: root },
  );
  if (ci.missing) reasons.push('GitHub CLI (gh) not found');
  else if (ci.code !== 0) reasons.push(`gh run list failed: ${ci.stderr.trim()}`);
  else {
    const [latest] = JSON.parse(ci.stdout || '[]');
    if (latest?.conclusion !== 'success')
      reasons.push(`latest CI run on main: ${latest?.conclusion ?? 'none'}`);
  }
  const scripts = npmScripts(root);
  for (const name of ['i18n:check', 'lint:strings', 'test:evidence', 'test:notifications', 'test:widgets']) {
    if (!scripts[name]) reasons.push(`npm script "${name}" is not defined yet`);
    else if (run('npm', ['run', name], { cwd: root }).code !== 0) reasons.push(`npm run ${name} failed`);
  }
  for (const guard of [
    'check-contrast.mjs',
    'check-notification-copy.mjs',
    'check-diabetes-copy.mjs',
    'check-logo.mjs',
    'check-assets.mjs',
  ]) {
    const step = run(process.execPath, [`scripts/${guard}`], { cwd: root, shell: false });
    if (step.code !== 0) reasons.push(step.stderr.trim());
  }
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
