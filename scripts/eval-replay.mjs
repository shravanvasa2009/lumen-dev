import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readCaptures } from './eval-replay/captures.mjs';
import { computeMetrics } from './eval-replay/metrics.mjs';
import { compareMetrics } from './eval-replay/recompute.mjs';

// npm run eval:replay -- --captures <folder> [--out docs/validation/metrics.json]
//   Reads every capture that tools/replay has processed and writes the Appendix B metrics file.
// npm run eval:replay -- --recompute <independent metrics.json> --agent <who> [--out docs/validation/metrics.json]
//   VER-1: records whether a second agent's independent recompute matches, and fails if it doesn't.
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`eval:replay: ${message}`);
  process.exit(1);
}

const out = argument('--out', 'docs/validation/metrics.json');

function readMetrics(file, hint) {
  if (!file || !fs.existsSync(file)) fail(`${file ?? 'metrics file'} not found; ${hint}`);
  const metrics = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(metrics.perTier)) fail(`${file} is not an Appendix B metrics.json (no perTier list)`);
  return metrics;
}

function recordRecompute(independentFile) {
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
  if (!fs.existsSync(capturesDir)) fail('pass --captures <folder of capture folders> (see Appendix B)');
  const { captures, missing } = readCaptures(capturesDir);
  if (missing.length)
    console.warn(
      `eval:replay: skipped ${missing.length} folder(s) with no replay-result.json: ${missing.join(', ')}`,
    );
  if (captures.length === 0) fail('no processed captures; run tools/replay on them first');
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

// --recompute with no file after it must not fall through to replay mode.
if (process.argv.includes('--recompute')) recordRecompute(argument('--recompute'));
else replayCaptures(argument('--captures', ''));
