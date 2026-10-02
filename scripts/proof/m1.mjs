import { findRepoRoot, npmScripts, run } from '../lib/workspace.mjs';

// M1: core signal processing and the Replay app, proven by the repo's own checks.
const REQUIRED = [
  'lint',
  'typecheck',
  'test',
  'golden:check',
  'test:synthetic',
  'test:redteam',
  'test:routes',
  'deadcode',
];

// npm test runs every workspace, and the last one's PASS lines can bury an earlier one's failure, so a
// failure shows the lines that name what failed, from stdout and stderr together.
const FAILURE_LINE = /^\s*(FAIL\b|●|✖|not ok\b|npm (error|ERR!)|\w*Error:)/;
const EXCERPT_LINES = 30;

function failureExcerpt(step) {
  const lines = `${step.stdout}\n${step.stderr}`.split('\n').filter((line) => line.trim());
  const flagged = lines.filter((line) => FAILURE_LINE.test(line));
  return (flagged.length ? flagged.slice(0, EXCERPT_LINES) : lines.slice(-EXCERPT_LINES)).join('\n');
}

export default function proveM1() {
  const root = findRepoRoot();
  const scripts = npmScripts(root);
  const reasons = [];
  for (const name of REQUIRED) {
    if (!scripts[name]) {
      reasons.push(`npm script "${name}" is not defined yet`);
      continue;
    }
    const step = run('npm', ['run', name], { cwd: root });
    if (step.code !== 0) reasons.push(`npm run ${name} failed (exit ${step.code}):\n${failureExcerpt(step)}`);
  }
  const scope = run(process.execPath, ['scripts/scope-guard.mjs'], { cwd: root, shell: false });
  if (scope.code !== 0) reasons.push(scope.stderr.trim());
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons };
}
