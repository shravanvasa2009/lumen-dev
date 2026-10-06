import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-notification-copy.mjs');
const COPY = 'apps/mobile/src/i18n/lockscreen.json';
const RES = 'apps/mobile/modules/lumen-widgets/android/src/main/res';

const lockStrings = (strings) =>
  `<resources>\n${Object.entries(strings)
    .map(([name, text]) => `    <string name="${name}">${text}</string>`)
    .join('\n')}\n</resources>\n`;

function runCheck({ copy, res }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-copy-'));
  fs.mkdirSync(path.dirname(path.join(root, COPY)), { recursive: true });
  fs.writeFileSync(path.join(root, COPY), JSON.stringify(copy));
  for (const [folder, strings] of Object.entries(res)) {
    fs.mkdirSync(path.join(root, RES, folder), { recursive: true });
    fs.writeFileSync(path.join(root, RES, folder, 'lumen_widget_lock_strings.xml'), lockStrings(strings));
  }
  const run = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  fs.rmSync(root, { recursive: true, force: true });
  return run;
}

const clean = () => ({
  copy: {
    en: { 'widget.lock.lastCheck': 'Last check {{hours}} h ago' },
    es: { 'widget.empty.title': 'Sin revisiones aún' },
  },
  res: {
    values: { lumen_widget_lock_no_checks: 'No checks yet' },
    'values-es': { lumen_widget_lock_check_now: 'Revisar ahora' },
  },
});

test('clean copy passes', () => {
  const run = runCheck(clean());
  assert.equal(run.status, 0, run.stderr);
});

test('a heart rate in lockscreen.json fails', () => {
  const files = clean();
  files.copy.en['widget.lock.lastCheck'] = 'Last check: 72 bpm';
  assert.equal(runCheck(files).status, 1);
});

for (const [folder, text] of [
  ['values', 'Last check 64 bpm'],
  ['values', 'No AFib found'],
  ['values-es', 'Sin diabetes'],
]) {
  test(`the Android lock widget's ${folder} string "${text}" fails`, () => {
    const files = clean();
    files.res[folder] = { ...files.res[folder], lumen_widget_lock_description: text };
    const run = runCheck(files);
    assert.equal(run.status, 1);
    assert.match(run.stderr, new RegExp(`android ${folder} lumen_widget_lock_description`));
  });
}

test('a missing Android lock widget strings file fails', () => {
  const files = clean();
  delete files.res.values;
  assert.equal(runCheck(files).status, 1);
});
