import { findRepoRoot, npmScripts, run } from '../lib/workspace.mjs';

// M1: core signal processing and the Replay app, proven by the repo's own checks.
const REQUIRED = ['lint', 'typecheck', 'test', 'golden:check', 'test:synthetic', 'test:redteam', 'test:routes', 'deadcode'];

export default function proveM1() {
  const root = findRepoRoot();
  const scripts = npmScripts(root);
  const reasons = [];
  for (const name of REQUIRED) {
    if (!scripts[name]) { reasons.push(`npm script "${name}" is not defined yet`); continue; }
    const step = run('npm', ['run', name], { cwd: root });
    if (step.code !== 0) reasons.push(`npm run ${name} failed:\n${(step.stderr || step.stdout).split('\n').slice(-12).join('\n')}`);
  }
  const scope = run(process.execPath, ['scripts/scope-guard.mjs'], { cwd: root, shell: false });
  if (scope.code !== 0) reasons.push(scope.stderr.trim());
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
