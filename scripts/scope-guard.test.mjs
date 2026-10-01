import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scope-guard.mjs');
// ROT13 of the front-camera lens-facing constant, so this file does not trip the banned-term scan.
const FRONT_CAMERA = 'YRAF_SNPVAT_SEBAG'.replace(/[A-Z]/g, (ch) =>
  String.fromCharCode(((ch.charCodeAt(0) - 65 + 13) % 26) + 65),
);

function guardExitCode(relativeFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-guard-'));
  try {
    const file = path.join(dir, relativeFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `let facing = ${FRONT_CAMERA}\n`);
    return spawnSync(process.execPath, [guard], { cwd: dir }).status;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('flags a front-camera API in the native module ios folder', () => {
  assert.equal(guardExitCode('apps/mobile/modules/lumen-capture/ios/Camera.swift'), 1);
});

test('flags a front-camera API in the native module android folder', () => {
  assert.equal(guardExitCode('apps/mobile/modules/lumen-capture/android/src/Camera.kt'), 1);
});

test('still skips the generated prebuild folders', () => {
  assert.equal(guardExitCode('apps/mobile/ios/Generated.swift'), 0);
  assert.equal(guardExitCode('apps/mobile/android/Generated.kt'), 0);
});
