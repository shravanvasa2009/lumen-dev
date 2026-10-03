import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { syncModels } from './sync-models.mjs';

const APP = path.join('apps', 'mobile', 'assets', 'models');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const roots = [];
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-models-'));
  roots.push(root);
  return root;
}

function snapshot(dir) {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name)).toString('hex')])
    : null;
}

const LOGISTIC_FILE = 'rhythm-logistic@1.0.0.onnx';
const LOGISTIC_BYTES = Buffer.from('weights of rhythm-logistic');

function ruleEntry() {
  return {
    name: 'rhythm-logistic',
    family: 'rhythm',
    ships: false,
    role: 'basic-analysis fallback',
    file: LOGISTIC_FILE,
    sha256: digest(LOGISTIC_BYTES),
    inputs: { features: [1, 3] },
    threshold: { af: 0.5 },
    abstainBelow: 0.5,
    rule: {
      method: 'probs = softmax(coefficients · z + intercepts), z = (features[featureIndices] − mean) / scale',
      features: ['a', 'b'],
      featureIndices: [0, 2],
      mean: [0, 1],
      scale: [1, 2],
      classes: ['normal', 'af', 'other'],
      coefficients: [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ],
      intercepts: [0, 0, 0],
    },
  };
}

function makeRepo(mutate = () => {}) {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'models'));
  const models = [
    ['rhythm-lgbm', 'rhythm', true],
    ['rhythm-net', 'rhythm', false],
    ['sqi-net', 'sqi', true],
    ['diabetes-net', 'diabetes', true],
  ].map(([name, family, ships]) => {
    const bytes = Buffer.from(`weights of ${name}`);
    fs.writeFileSync(path.join(root, 'models', `${name}@1.0.0.onnx`), bytes);
    return { name, family, ships, file: `${name}@1.0.0.onnx`, sha256: digest(bytes) };
  });
  fs.writeFileSync(path.join(root, 'models', LOGISTIC_FILE), LOGISTIC_BYTES);
  models.push(ruleEntry());
  mutate(models, root);
  fs.writeFileSync(path.join(root, 'models', 'manifest.json'), JSON.stringify({ models }));
  return root;
}

test('copies only shipped models and writes the manifest subset', () => {
  const root = makeRepo();
  const manifestBefore = fs.readFileSync(path.join(root, 'models', 'manifest.json'));
  const { errors, copied } = syncModels({ root });
  assert.deepEqual(fs.readFileSync(path.join(root, 'models', 'manifest.json')), manifestBefore);
  assert.deepEqual(errors, []);
  assert.deepEqual(copied.sort(), [
    'diabetes-net@1.0.0.onnx',
    'rhythm-lgbm@1.0.0.onnx',
    'sqi-net@1.0.0.onnx',
  ]);
  assert.ok(!fs.existsSync(path.join(root, APP, 'rhythm-net@1.0.0.onnx')));
  const subset = JSON.parse(fs.readFileSync(path.join(root, APP, 'manifest.json'), 'utf8'));
  assert.equal(subset.models.length, 4);
  assert.deepEqual(subset.models[3], ruleEntry());
  assert.deepEqual(syncModels({ root, check: true }).errors, []);
});

test('removes a model that no longer ships', () => {
  const root = makeRepo();
  fs.mkdirSync(path.join(root, APP), { recursive: true });
  fs.writeFileSync(path.join(root, APP, 'rhythm-net@1.0.0.onnx'), 'old');
  syncModels({ root });
  assert.ok(!fs.existsSync(path.join(root, APP, 'rhythm-net@1.0.0.onnx')));
});

test('fails on a sha256 mismatch and copies nothing', () => {
  const root = makeRepo((models) => {
    models[0].sha256 = 'f'.repeat(64);
  });
  const { errors } = syncModels({ root });
  assert.match(errors[0], /rhythm-lgbm@1.0.0.onnx sha256 does not match/);
  assert.ok(!fs.existsSync(path.join(root, APP)));
});

test('fails unless each family has exactly one shipped model', () => {
  const none = makeRepo((models) => {
    models[2].ships = false;
  });
  assert.match(syncModels({ root: none }).errors[0], /0 shipped sqi/);
  const two = makeRepo((models) => {
    models[1].ships = true;
  });
  assert.match(syncModels({ root: two }).errors[0], /2 shipped rhythm/);
});

test('fails when a shipped file is missing', () => {
  const root = makeRepo((models, dir) => fs.rmSync(path.join(dir, 'models', models[3].file)));
  assert.match(syncModels({ root }).errors[0], /diabetes-net@1.0.0.onnx missing/);
});

test('fails when the manifest is missing', () => {
  const root = tempRoot();
  assert.deepEqual(syncModels({ root }).errors, ['models/manifest.json not found']);
});

test('--check reports a missing, stale, or extra app copy', () => {
  const root = makeRepo();
  assert.equal(syncModels({ root, check: true }).errors.length, 4);
  syncModels({ root });
  fs.writeFileSync(path.join(root, APP, 'sqi-net@1.0.0.onnx'), 'tampered');
  fs.writeFileSync(path.join(root, APP, 'rhythm-net@1.0.0.onnx'), 'extra');
  const { errors } = syncModels({ root, check: true });
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /sqi-net@1.0.0.onnx is missing or stale/);
  assert.match(errors.join('\n'), /rhythm-net@1.0.0.onnx is not a shipped model/);
});

test('a failed sync leaves an existing app copy byte-for-byte unchanged', () => {
  const root = makeRepo();
  syncModels({ root });
  fs.writeFileSync(path.join(root, APP, 'extra@1.0.0.onnx'), 'extra');
  fs.writeFileSync(path.join(root, 'models', 'sqi-net@1.0.0.onnx'), 'changed after the manifest');
  const before = snapshot(path.join(root, APP));
  assert.match(syncModels({ root }).errors[0], /sqi-net@1.0.0.onnx sha256 does not match/);
  assert.deepEqual(snapshot(path.join(root, APP)), before);
});

test('rejects a file name with a path or the wrong extension before writing', () => {
  for (const file of ['../escape.onnx', 'sub/model.onnx', 'model.bin']) {
    const root = makeRepo((models) => {
      models[0].file = file;
    });
    assert.match(syncModels({ root }).errors[0], /must be a bare .onnx file name/);
    assert.ok(!fs.existsSync(path.join(root, APP)));
  }
});

test('names a shipped entry whose family is unknown', () => {
  const root = makeRepo((models) => {
    models[1].family = 'ecg';
    models[1].ships = true;
  });
  assert.match(syncModels({ root }).errors.join(', '), /rhythm-net ships but has unknown family "ecg"/);
});

test('copies a rule entry into the app manifest but not its .onnx', () => {
  const root = makeRepo();
  assert.ok(fs.existsSync(path.join(root, 'models', LOGISTIC_FILE)));
  const { copied } = syncModels({ root });
  assert.ok(!copied.includes(LOGISTIC_FILE));
  assert.ok(!fs.readdirSync(path.join(root, APP)).includes(LOGISTIC_FILE));
  const subset = JSON.parse(fs.readFileSync(path.join(root, APP, 'manifest.json'), 'utf8'));
  assert.deepEqual(subset.models.filter((model) => model.name === 'rhythm-logistic'), [ruleEntry()]);
});

test('--check flags a rule entry .onnx found in the app folder', () => {
  const root = makeRepo();
  syncModels({ root });
  fs.writeFileSync(path.join(root, APP, LOGISTIC_FILE), LOGISTIC_BYTES);
  const { errors } = syncModels({ root, check: true });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /rhythm-logistic@1.0.0.onnx is not a shipped model/);
});

test('a rule entry that itself ships is listed once and its .onnx is copied', () => {
  const root = makeRepo((models) => {
    models[0].ships = false;
    models[4].ships = true;
  });
  const { errors, copied } = syncModels({ root });
  assert.deepEqual(errors, []);
  assert.ok(copied.includes(LOGISTIC_FILE));
  assert.ok(fs.existsSync(path.join(root, APP, LOGISTIC_FILE)));
  const subset = JSON.parse(fs.readFileSync(path.join(root, APP, 'manifest.json'), 'utf8'));
  assert.equal(subset.models.filter((model) => model.name === 'rhythm-logistic').length, 1);
  assert.equal(subset.models.length, 3);
});

test('--check fails when a rule entry is missing or differs from the source', () => {
  const root = makeRepo();
  syncModels({ root });
  const appManifest = path.join(root, APP, 'manifest.json');
  const synced = JSON.parse(fs.readFileSync(appManifest, 'utf8'));
  synced.models.pop();
  fs.writeFileSync(appManifest, `${JSON.stringify(synced, null, 2)}\n`);
  assert.match(syncModels({ root, check: true }).errors.join('\n'), /manifest.json is missing or stale/);
  synced.models.push({ ...ruleEntry(), threshold: { af: 0.9 } });
  fs.writeFileSync(appManifest, `${JSON.stringify(synced, null, 2)}\n`);
  assert.match(syncModels({ root, check: true }).errors.join('\n'), /manifest.json is missing or stale/);
});
