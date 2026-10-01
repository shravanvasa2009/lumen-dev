import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot } from './lib/workspace.mjs';

// ADR 0031: the app loads only the manifest entry marked ships: true, one per family (spec 11.9).
const FAMILIES = ['rhythm', 'sqi', 'diabetes'];
const APP_MODELS = path.join('apps', 'mobile', 'assets', 'models');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function shippedEntries(manifest, errors) {
  const entries = [];
  for (const model of manifest.models ?? [])
    if (model.ships === true && !FAMILIES.includes(model.family))
      errors.push(`${model.name} ships but has unknown family ${JSON.stringify(model.family)}`);
  for (const family of FAMILIES) {
    const shipped = (manifest.models ?? []).filter(
      (model) => model.family === family && model.ships === true,
    );
    if (shipped.length !== 1)
      errors.push(`manifest has ${shipped.length} shipped ${family} models; need exactly 1`);
    else entries.push(shipped[0]);
  }
  return entries;
}

// Returns the problems found; in sync mode it also writes the app copy when there are none.
export function syncModels({ root, check = false }) {
  const source = path.join(root, 'models');
  const target = path.join(root, APP_MODELS);
  const manifestFile = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return { errors: ['models/manifest.json not found'], copied: [] };
  const errors = [];
  const entries = shippedEntries(JSON.parse(fs.readFileSync(manifestFile, 'utf8')), errors);
  for (const entry of entries) {
    if (path.basename(String(entry.file)) !== entry.file || !entry.file.endsWith('.onnx')) {
      errors.push(`${entry.name} file ${JSON.stringify(entry.file)} must be a bare .onnx file name`);
      continue;
    }
    const file = path.join(source, entry.file);
    if (!fs.existsSync(file)) errors.push(`${entry.file} missing from models/`);
    else if (sha256(file) !== entry.sha256) errors.push(`${entry.file} sha256 does not match the manifest`);
  }
  if (errors.length > 0) return { errors, copied: [] };

  const subset = `${JSON.stringify({ models: entries }, null, 2)}\n`;
  const wanted = new Set(entries.map((entry) => entry.file));
  const present = fs.existsSync(target)
    ? fs.readdirSync(target).filter((name) => name.endsWith('.onnx'))
    : [];
  if (check) {
    const appManifest = path.join(target, 'manifest.json');
    if (!fs.existsSync(appManifest) || fs.readFileSync(appManifest, 'utf8') !== subset)
      errors.push(`${APP_MODELS}/manifest.json is missing or stale`);
    for (const entry of entries) {
      const copy = path.join(target, entry.file);
      if (!fs.existsSync(copy) || sha256(copy) !== entry.sha256)
        errors.push(`${APP_MODELS}/${entry.file} is missing or stale`);
    }
    for (const name of present.filter((name) => !wanted.has(name)))
      errors.push(`${APP_MODELS}/${name} is not a shipped model`);
    return { errors, copied: [] };
  }

  fs.mkdirSync(target, { recursive: true });
  for (const name of present.filter((name) => !wanted.has(name))) fs.rmSync(path.join(target, name));
  for (const entry of entries) fs.copyFileSync(path.join(source, entry.file), path.join(target, entry.file));
  fs.writeFileSync(path.join(target, 'manifest.json'), subset);
  return { errors, copied: entries.map((entry) => entry.file) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { errors, copied } = syncModels({ root: findRepoRoot(), check });
  if (errors.length > 0) {
    errors.forEach((line) => console.error(`sync-models: ${line}`));
    process.exit(1);
  }
  console.log(
    check ? 'sync-models: app copy matches the manifest' : `sync-models: copied ${copied.join(', ')}`,
  );
}
