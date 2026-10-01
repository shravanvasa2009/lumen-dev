import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepoRoot, run } from './lib/workspace.mjs';

// Environment checks for the owner's setup: Windows PC, iPhone via EAS cloud builds, Android emulator.
const checks = [];
const add = (name, ok, fix) => checks.push({ name, ok, fix });
const version = (cmd, args = ['--version']) => run(cmd, args);

const nodeMajor = Number(process.versions.node.split('.')[0]);
add(`Node ${process.versions.node} (LTS 20 or newer)`, nodeMajor >= 20, 'Install the current LTS from https://nodejs.org');
add('npm', version('npm').code === 0, 'npm ships with Node; reinstall Node LTS');
const git = version('git');
add('git', git.code === 0, 'Install Git for Windows from https://git-scm.com/download/win');
if (git.code === 0) {
  add('git core.longpaths = true', run('git', ['config', '--global', 'core.longpaths']).stdout.trim() === 'true', 'Run: git config --global core.longpaths true');
  add('git core.autocrlf = false', run('git', ['config', '--global', 'core.autocrlf']).stdout.trim() === 'false', 'Run: git config --global core.autocrlf false');
}
const gh = run('gh', ['auth', 'status']);
add('GitHub CLI logged in', gh.code === 0, gh.missing ? 'Install GitHub CLI from https://cli.github.com, then run: gh auth login' : 'Run: gh auth login (GitHub.com → HTTPS → login with a web browser)');
const root = findRepoRoot();
if (root && gh.code === 0) {
  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout.trim();
  add(`repo remote (${remote || 'none'})`, Boolean(remote), 'Clone the repo with: gh repo clone <you>/<repo> app');
  const slug = remote.replace(/\.git$/, '').split(/[:/]/).slice(-2).join('/');
  if (slug.includes('/')) {
    const protection = run('gh', ['api', `repos/${slug}/branches/main/protection`], { cwd: root });
    add('main is protected', protection.code === 0, 'Follow the HUMAN_STEPS request for protecting main (after the first CI run)');
  }
}
// Prefer the global eas command (HUMAN_STEPS installs it globally); fall back to a local eas-cli.
const easCmd = (args) => {
  const global = run('eas', args);
  return global.missing ? run('npx', ['--no-install', 'eas-cli', ...args]) : global;
};
const eas = easCmd(['whoami']);
add('EAS CLI logged in', eas.code === 0, 'Run: npm install -g eas-cli, then: eas login');
if (eas.code === 0) {
  const devices = easCmd(['device:list', '--non-interactive']);
  add('iPhone registered with EAS', devices.code === 0 && /iPhone|iOS/i.test(devices.stdout), 'Run: eas device:create and open the link on the iPhone');
}
add('uv', version('uv').code === 0, 'Install uv: https://docs.astral.sh/uv/getting-started/installation/');
const py = run('uv', ['python', 'find', '3.11']);
add('Python 3.11 available to uv', py.code === 0, 'Run: uv python install 3.11');
const adb = run('adb', ['devices']);
add('adb (Android SDK platform-tools)', adb.code === 0, 'Install Android Studio (or platform-tools) and add platform-tools to PATH');
if (adb.code === 0) add('an Android emulator or BlueStacks is connected', /\tdevice\b/.test(adb.stdout), 'Start the emulator, or enable ADB in BlueStacks and run: adb connect 127.0.0.1:<port>');
if (process.platform === 'win32') {
  const reg = run('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled']);
  add('Windows long paths enabled', /0x1\b/.test(reg.stdout), 'Run the admin PowerShell command in HUMAN_STEPS (long paths)');
}
const here = root ?? process.cwd();
add(`project path is short (${here.length} characters)`, here.length <= 60, 'Keep the workspace at C:\\lumen\\lumen-workspace');
const free = fs.statfsSync(here);
const freeGb = (free.bavail * free.bsize) / 1e9;
add(`free disk space ${freeGb.toFixed(0)} GB`, freeGb >= 20, 'Free at least 20 GB (node_modules, Android SDK, datasets)');

const failed = checks.filter((check) => !check.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.ok ? '' : `\n      fix: ${check.fix}`}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed on ${os.platform()}.`);
console.log(failed.length ? `Next action: ${failed[0].fix}` : 'Next action: none. The environment is ready.');
process.exit(failed.length ? 1 : 0);
