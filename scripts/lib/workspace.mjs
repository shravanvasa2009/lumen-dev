import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The repo is cloned inside a private workspace (app/ or worktrees/<track>/); private data such as
// captures and the device-test log live there, never in the repo.
export function findWorkspace(start = process.cwd()) {
  if (process.env.LUMEN_WORKSPACE) return path.resolve(process.env.LUMEN_WORKSPACE);
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, 'HUMAN_STEPS.md')) && fs.existsSync(path.join(dir, '.claude')))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath) && JSON.parse(fs.readFileSync(pkgPath, 'utf8')).lumen) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function captureDir() {
  if (process.env.LUMEN_CAPTURE_DIR) return path.resolve(process.env.LUMEN_CAPTURE_DIR);
  const ws = findWorkspace();
  return ws ? path.join(ws, 'captures') : path.resolve('..', 'captures');
}

export function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// shell: true on Windows so npm/npx/gh/eas resolve through their .cmd shims.
export function run(cmd, args, options = {}) {
  const proc = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options });
  return {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? '',
    missing: proc.error?.code === 'ENOENT',
  };
}

export function npmScripts(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};
}
