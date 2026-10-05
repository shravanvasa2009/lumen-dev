import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-diabetes-copy.mjs');
const I18N = 'apps/mobile/src/i18n';

function runCheck(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diabetes-copy-'));
  fs.mkdirSync(path.join(root, I18N), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, I18N, name), JSON.stringify(content));
  }
  const run = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  fs.rmSync(root, { recursive: true, force: true });
  return run;
}

const cleanFiles = () => ({
  'diabetes.json': {
    en: { 'dm.flag.body': 'This is not a diabetes test.' },
    es: { 'dm.flag.body': 'Esto no es una prueba de diabetes.' },
  },
  'en.json': { 'dr.title': 'Diabetes risk questions', 'home.title': 'Home' },
  'es.json': { 'dr.title': 'Preguntas de riesgo de diabetes', 'home.title': 'Inicio' },
});

test('clean copy passes', () => {
  assert.equal(runCheck(cleanFiles()).status, 0);
});

for (const [file, key, text] of [
  ['en.json', 'dr.result.high', 'You have a high risk of diabetes.'],
  ['es.json', 'dr.result.high', 'Tienes un riesgo alto de diabetes.'],
  ['en.json', 'dm.flag.title', 'Your glucose is high'],
  ['es.json', 'profile.diabetesRisk', 'Diagnosticada con diabetes'],
  ['en.json', 'followUp.whatToAskBody', 'You have diabetes. Ask for an A1c blood test.'],
  ['es.json', 'checks.status.dmDone', 'Tienes diabetes'],
]) {
  test(`banned wording in ${file} ${key} is caught`, () => {
    const files = cleanFiles();
    files[file][key] = text;
    const run = runCheck(files);
    assert.equal(run.status, 1);
    assert.ok(run.stderr.includes(`${file} ${key}:`));
  });
}

test('banned wording outside the diabetes keys is ignored', () => {
  const files = cleanFiles();
  files['en.json']['home.title'] = 'You have a streak';
  assert.equal(runCheck(files).status, 0);
});
