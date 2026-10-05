import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot, npmScripts, run } from './lib/workspace.mjs';

// Runs before every commit (via the Claude Code pre-commit hook and CI). Before bootstrap, only the
// dependency-free guards can run; after bootstrap ("lumen.bootstrapped": true) missing tools are failures.
const root = findRepoRoot();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bootstrapped = pkg.lumen?.bootstrapped === true;
const scripts = npmScripts(root);
const failures = [];

// Each guard reads a file the template ships; before bootstrap a missing input is skipped, after it
// is a failure.
const GUARDS = {
  'scope-guard.mjs': null,
  'priv-check.mjs': null,
  'check-contrast.mjs': 'apps/mobile/src/theme/tokens.json',
  'check-notification-copy.mjs': 'apps/mobile/src/i18n/lockscreen.json',
  'check-diabetes-copy.mjs': 'apps/mobile/src/i18n/diabetes.json',
  'check-logo.mjs': 'apps/mobile/assets/brand',
  'check-assets.mjs': 'apps/mobile/app.config.brand.json',
};
for (const [guard, input] of Object.entries(GUARDS)) {
  if (input && !fs.existsSync(path.join(root, input))) {
    if (bootstrapped) failures.push(`${guard}: ${input} is missing`);
    else console.log(`skip ${guard}: ${input} not present yet`);
    continue;
  }
  const step = run(process.execPath, [path.join('scripts', guard)], { cwd: root, shell: false });
  if (step.code !== 0) failures.push(step.stderr.trim());
}
const style = run(process.execPath, [path.join('scripts', 'check-style.mjs')], { cwd: root, shell: false });
if (style.code !== 0) failures.push(style.stderr.trim());

for (const name of ['lint', 'typecheck', 'test:changed']) {
  if (!scripts[name]) {
    if (bootstrapped) failures.push(`npm script "${name}" is missing`);
    else console.log(`skip ${name}: app not bootstrapped yet`);
    continue;
  }
  // Jest prints every console warning; past spawnSync's 1 MB default the run is killed and reported as a
  // failure.
  const step = run('npm', ['run', name], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  if (step.code !== 0)
    failures.push(
      `npm run ${name} failed:\n${(step.stdout + step.stderr).split('\n').slice(-15).join('\n')}`,
    );
}
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}
console.log('verify:fast OK');
