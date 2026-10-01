import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readCaptures } from './eval-replay/captures.mjs';
import { buildEvidence } from './eval-replay/evidence.mjs';
import { computeMetrics } from './eval-replay/metrics.mjs';
import { compareMetrics } from './eval-replay/recompute.mjs';

// npm run eval:replay -- --captures <folder> [--out docs/validation/metrics.json]
//   Reads every capture that tools/replay has processed and writes the Appendix B metrics file.
// npm run eval:replay -- --recompute <independent metrics.json> --agent <who> [--out docs/validation/metrics.json]
//   VER-1: records whether a second agent's independent recompute matches, and fails if it doesn't.
// npm run eval:replay -- --evidence [--metrics docs/validation/metrics.json] [--out docs/validation/evidence.json]
//   [--app apps/mobile/assets/evidence.json]
//   Writes evidence.json labels from a recomputed metrics.json (ADR 0044) and copies it into the app.
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`eval:replay: ${message}`);
  process.exit(1);
}

const METRICS_FILE = 'docs/validation/metrics.json';

function readMetrics(file, hint) {
  if (!file || !fs.existsSync(file)) fail(`${file ?? 'metrics file'} not found; ${hint}`);
  const metrics = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(metrics.perTier)) fail(`${file} is not an Appendix B metrics.json (no perTier list)`);
  return metrics;
}

function recordRecompute(independentFile) {
  const out = argument('--out', METRICS_FILE);
  const agent = argument('--agent');
  if (!agent) fail('--recompute needs --agent <who recomputed it>');
  const metrics = readMetrics(out, 'run eval:replay on the captures first');
  const { matches, differences } = compareMetrics(
    metrics,
    readMetrics(independentFile, 'pass the second agent’s metrics.json to --recompute'),
  );
  fs.writeFileSync(
    out,
    `${JSON.stringify({ ...metrics, recompute: { agent, matches, differences } }, null, 2)}\n`,
  );
  if (!matches) fail(`VER-1 recompute does not match:\n${differences.join('\n')}`);
  console.log(`eval:replay: VER-1 recompute by ${agent} matches → ${out}`);
}

function replayCaptures(capturesDir) {
  const out = argument('--out', METRICS_FILE);
  if (!fs.existsSync(capturesDir)) fail('pass --captures <folder of capture folders> (see Appendix B)');
  const { captures, missing } = readCaptures(capturesDir);
  if (missing.length)
    console.warn(
      `eval:replay: skipped ${missing.length} folder(s) with no replay-result.json: ${missing.join(', ')}`,
    );
  if (captures.length === 0) fail('no processed captures; run tools/replay on them first');
  for (const capture of captures.filter((each) => each.strapDropouts > 0))
    console.warn(
      `eval:replay: ${capture.folder}: ${capture.strapDropouts} strap dropout(s); only the longest unbroken stretch is used`,
    );
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const metrics = computeMetrics(
    captures,
    { commit, date: new Date().toISOString().slice(0, 10) },
    console.log,
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(
    `eval:replay: ${captures.length} captures → ${out} (HR MAE ${metrics.hr.maeBpm} bpm over ${metrics.hr.people} people)`,
  );
}

function writeEvidence() {
  const metricsFile = argument('--metrics', METRICS_FILE);
  const out = argument('--out', 'docs/validation/evidence.json');
  const appCopy = argument('--app', 'apps/mobile/assets/evidence.json');
  const metrics = readMetrics(metricsFile, 'run eval:replay on the captures first');
  // VER-1: no label is earned until a second agent's recompute has matched.
  if (metrics.recompute?.matches !== true)
    fail(`${metricsFile} has no matching recompute; run eval:replay -- --recompute first (VER-1)`);
  if (!fs.existsSync(out)) fail(`${out} not found; it holds the rhythm and diabetes evidence to keep`);
  const evidence = buildEvidence(metrics, JSON.parse(fs.readFileSync(out, 'utf8')));
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(out, text);
  fs.mkdirSync(path.dirname(appCopy), { recursive: true });
  fs.writeFileSync(appCopy, text);
  const labels = ['hr', 'hrv', 'resp'].map((key) => `${key} ${evidence.metrics[key].label}`).join(', ');
  console.log(`eval:replay: ${labels} → ${out} and ${appCopy}`);
}

// --recompute with no file after it must not fall through to replay mode.
if (process.argv.includes('--recompute')) recordRecompute(argument('--recompute'));
else if (process.argv.includes('--evidence')) writeEvidence();
else replayCaptures(argument('--captures', ''));
