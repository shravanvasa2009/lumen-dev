import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readCaptures } from './eval-replay/captures.mjs';
import { computeMetrics } from './eval-replay/metrics.mjs';

// npm run eval:replay -- --captures <folder> [--out docs/validation/metrics.json]
// Reads every capture that tools/replay has processed and writes the Appendix B metrics file.
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const capturesDir = argument('--captures');
if (!capturesDir || !fs.existsSync(capturesDir)) {
  console.error('eval:replay: pass --captures <folder of capture folders> (see Appendix B)');
  process.exit(1);
}
const out = argument('--out', 'docs/validation/metrics.json');

const { captures, missing } = readCaptures(capturesDir);
if (missing.length)
  console.warn(
    `eval:replay: skipped ${missing.length} folder(s) with no replay-result.json: ${missing.join(', ')}`,
  );
if (captures.length === 0) {
  console.error('eval:replay: no processed captures; run tools/replay on them first');
  process.exit(1);
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const metrics = computeMetrics(captures, { commit, date: new Date().toISOString().slice(0, 10) });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(metrics, null, 2)}\n`);
console.log(
  `eval:replay: ${captures.length} captures → ${out} (HR MAE ${metrics.hr.maeBpm} bpm over ${metrics.hr.people} people)`,
);
