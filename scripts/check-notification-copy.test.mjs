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
  // A folder's value is either name → text, or the whole file's XML when a case needs markup.
  for (const [folder, strings] of Object.entries(res)) {
    fs.mkdirSync(path.join(root, RES, folder), { recursive: true });
    const xml = typeof strings === 'string' ? strings : lockStrings(strings);
    fs.writeFileSync(path.join(root, RES, folder, 'lumen_widget_lock_strings.xml'), xml);
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

// Fails closed: a string the check can't read as plain text is a failure, whatever it says.
for (const [label, xml] of [
  [
    'a <b>-wrapped health word',
    '<resources><string name="lock_line">Last check <b>AFib</b></string></resources>',
  ],
  [
    'an <xliff:g> placeholder',
    '<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2"><string name="lock_line">Last check ' +
      '<xliff:g id="bpm" example="64">%1$d</xliff:g> bpm</string></resources>',
  ],
  ['a CDATA section', '<resources><string name="lock_line"><![CDATA[No checks yet]]></string></resources>'],
  ['an empty self-closed string', '<resources><string name="lock_line" /></resources>'],
  [
    'a string the pattern cannot match',
    '<resources><string translatable="false" name="lock_line">No checks yet</string></resources>',
  ],
]) {
  test(`${label} fails`, () => {
    const files = clean();
    files.res.values = xml;
    const run = runCheck(files);
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /WID-2 failed/);
  });
}

for (const [label, xml, name] of [
  ['an uppercase name', '<resources><string name="Lock_Line">No AFib</string></resources>', 'Lock_Line'],
  [
    'a plurals item',
    '<resources><plurals name="lock_hours"><item quantity="one">1 h</item><item quantity="other">%d bpm</item>' +
      '</plurals></resources>',
    'plurals lock_hours\\[1\\]',
  ],
  [
    'a string-array item',
    '<resources><string-array name="lock_lines"><item>No checks yet</item><item>Diabetes</item></string-array>' +
      '</resources>',
    'string-array lock_lines\\[1\\]',
  ],
]) {
  test(`a health word in ${label} fails`, () => {
    const files = clean();
    files.res.values = xml;
    const run = runCheck(files);
    assert.equal(run.status, 1);
    assert.match(run.stderr, new RegExp(`android values ${name}`));
  });
}

test("Android's escaped apostrophe is read as an apostrophe", () => {
  const files = clean();
  files.res.values = {
    lumen_widget_lock_no_checks: "Don\\'t wait",
    lumen_widget_lock_description: "AFib\\'s check",
  };
  const run = runCheck(files);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /lumen_widget_lock_description: "AFib's check"/);
  assert.doesNotMatch(run.stderr, /no_checks/);
});

test('clean plurals and string-array items pass', () => {
  const files = clean();
  files.res.values =
    '<resources><string name="lock_line">No checks yet</string><plurals name="lock_hours">' +
    '<item quantity="one">Last check %d h ago</item><item quantity="other">Last check %d h ago</item></plurals>' +
    '<string-array name="lock_lines"><item>Check now</item></string-array></resources>';
  const run = runCheck(files);
  assert.equal(run.status, 0, run.stderr);
});

test('a missing Android lock widget strings file fails', () => {
  const files = clean();
  delete files.res.values;
  assert.equal(runCheck(files).status, 1);
});
