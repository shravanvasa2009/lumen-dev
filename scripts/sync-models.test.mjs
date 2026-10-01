import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { syncModels } from './sync-models.mjs';

const APP = path.join('apps', 'mobile', 'assets', 'models');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function makeRepo(mutate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-models-'));
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
  mutate(models, root);
  fs.writeFileSync(path.join(root, 'models', 'manifest.json'), JSON.stringify({ models }));
  return root;
}

test('copies only shipped models and writes the manifest subset', () => {
  const root = makeRepo();
  const { errors, copied } = syncModels({ root });
  assert.deepEqual(errors, []);
  assert.deepEqual(copied.sort(), [
    'diabetes-net@1.0.0.onnx',
    'rhythm-lgbm@1.0.0.onnx',
    'sqi-net@1.0.0.onnx',
  ]);
  assert.ok(!fs.existsSync(path.join(root, APP, 'rhythm-net@1.0.0.onnx')));
  const subset = JSON.parse(fs.readFileSync(path.join(root, APP, 'manifest.json'), 'utf8'));
  assert.equal(subset.models.length, 3);
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-models-'));
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
