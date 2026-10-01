import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderReport } from './eval-replay/report.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'eval-replay.mjs');

const metricsFixture = (perTier) => ({
  commit: 'abc123',
  date: '2026-10-20',
  polarPairedCaptures: 30,
  hr: { maeBpm: 2.41, ci95: [1.9, 2.95], people: 10, readings: 30, phones: 2 },
  intervals: { maeMs: 14.2, ci95: [11.1, 17.6] },
  rmssd: { withinPct: 80, medianErrorPct: 6.5, people: 10 },
  resp: { maeBrpm: null, people: 0 },
  artifactCaptures: { total: 5, rejectedOrInconclusive: 5 },
  ux1: { firstReadings: 10, conclusive: 9 },
  ml5: { sinusReadings: 28, falseIrregular: 1 },
  perTier,
  recompute: { agent: null, matches: null },
});

test('metrics.md shows every measure with its n and CI, and no label', () => {
  const report = renderReport(
    metricsFixture([{ tier: 'full', phones: 1, hrMaeBpm: 2.41, intervalMaeMs: 14.2 }]),
  );
  assert.match(report, /Commit abc123, 2026-10-20/);
  assert.match(report, /2\.41 bpm \(95% CI 1\.9–2\.95 bpm\) \| 10 people, 30 readings, 2 phones/);
  assert.match(report, /80% of readings; median error 6\.5%/);
  assert.match(report, /Breathing-rate error, paced \(RESP-1\) \| not measured \| 0 people/);
  assert.match(report, /\(ML-5\) \| 3\.6% \| 1 of 28 readings/);
  assert.match(report, /First readings that were conclusive \(UX-1\) \| 90% \| 9 of 10/);
  assert.match(report, /Independent recompute \(VER-1\): not run yet/);
  assert.match(report, /Fewer than two tiers have measured error/);
  assert.doesNotMatch(report, /checked|passed|experimental/i);
});

test('tiers are listed from Full down, and a higher tier without lower error is called out (§5.4)', () => {
  const report = renderReport(
    metricsFixture([
      { tier: 'limited', phones: 1, hrMaeBpm: 4.2, intervalMaeMs: 30 },
      { tier: 'basic', phones: 2, hrMaeBpm: 2.1, intervalMaeMs: 22 },
      { tier: 'full', phones: 1, hrMaeBpm: 2.4, intervalMaeMs: 12 },
    ]),
  );
  const rows = report.split('\n').filter((line) => /^\| (full|basic|limited) \|/.test(line));
  assert.deepEqual(
    rows.map((line) => line.split(' | ')[0]),
    ['| full', '| basic', '| limited'],
  );
  assert.match(report, /Full does not show lower HR error than basic \(2\.4 vs 2\.1 bpm\)\./);
  assert.doesNotMatch(report, /lower interval error/);
  assert.match(report, /The rating is a feature gate only; it does not predict accuracy\./);
});

test('tiers whose error falls with each step say so', () => {
  const report = renderReport(
    metricsFixture([
      { tier: 'basic', phones: 2, hrMaeBpm: 2.9, intervalMaeMs: 22 },
      { tier: 'full', phones: 1, hrMaeBpm: 2.4, intervalMaeMs: null },
    ]),
  );
  assert.match(report, /Each higher tier shows lower error than the tier below it in this data\./);
});

test('the recompute rewrites metrics.md with its result', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'metrics.json');
  const independent = path.join(root, 'independent.json');
  const metrics = metricsFixture([{ tier: 'full', phones: 1, hrMaeBpm: 2.41, intervalMaeMs: 14.2 }]);
  fs.writeFileSync(out, JSON.stringify(metrics));
  fs.writeFileSync(independent, JSON.stringify(metrics));
  const run = spawnSync(
    process.execPath,
    [CLI, '--recompute', independent, '--agent', 'second-agent', '--out', out],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(
    fs.readFileSync(path.join(root, 'metrics.md'), 'utf8'),
    /Independent recompute \(VER-1\): matches \(second-agent\)/,
  );
});
