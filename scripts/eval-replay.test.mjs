import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { alignIntervals } from './eval-replay/align.mjs';
import { readCaptures } from './eval-replay/captures.mjs';
import { computeMetrics } from './eval-replay/metrics.mjs';
import { rmssd, subjectBootstrap } from './eval-replay/stats.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'eval-replay.mjs');

// A deterministic, irregular-enough interval sequence (ms) so cross-correlation has a clear peak.
const sequence = (length, offset = 0) =>
  Array.from(
    { length },
    (_, i) => 800 + 60 * Math.sin((i + offset) * 1.7) + 25 * Math.cos((i + offset) * 0.6),
  );

test('alignment finds the beat lag between phone and strap', () => {
  const polar = sequence(60);
  const phone = polar.slice(3, 50).map((value) => value + 4);
  const best = alignIntervals(phone, polar);
  assert.equal(best.lag, 3);
  assert.ok(best.correlation > 0.99);
  assert.deepEqual(best.polar, polar.slice(3, 50));
});

test('alignment refuses sequences too short to correlate', () => {
  assert.equal(alignIntervals(sequence(5), sequence(5)), null);
});

test('RMSSD of a known sequence', () => {
  assert.equal(rmssd([800, 810, 790, 800]), Math.sqrt((100 + 400 + 100) / 3));
});

test('the subject bootstrap is reproducible and brackets the mean', () => {
  const rows = ['P1', 'P1', 'P2', 'P3', 'P3', 'P4'].map((subject, i) => ({
    subject,
    value: [1, 2, 3, 4, 2, 5][i],
  }));
  const first = subjectBootstrap(rows);
  assert.deepEqual(subjectBootstrap(rows), first);
  assert.equal(first.value, 17 / 6);
  assert.ok(first.ci95[0] <= first.value && first.value <= first.ci95[1]);
  assert.deepEqual(subjectBootstrap([]), { value: null, ci95: null });
});

function capture({ subject, hr, polarHr, tier = 'full', fps = 60, labels = {}, reading = {} }) {
  // Scaled so the strap's mean interval is exactly 60000 / polarHr ms.
  const raw = sequence(40);
  const rawMean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
  const polarRrMs = raw.map((value) => (value * 60000) / rawMean / polarHr);
  return {
    folder: `${subject}-${hr}`,
    meta: { modelId: `phone-${tier}`, fps, rating: { score: 80, tier }, subject: { code: subject }, labels },
    reading: {
      headlineKey: 'result.regular',
      metrics: { hr: { value: hr }, rhythm: { flag: null } },
      ...reading,
    },
    polarRrMs,
    phoneRrMs: polarRrMs.slice(2, 38).map((value) => value + 10),
  };
}

test('metrics follow Appendix B and skip inconclusive readings', () => {
  const captures = [
    capture({ subject: 'P1', hr: 62, polarHr: 60, labels: { rhythm: 'sinus', firstReading: true } }),
    capture({ subject: 'P2', hr: 70, polarHr: 71, labels: { rhythm: 'sinus' } }),
    capture({
      subject: 'P3',
      hr: 80,
      polarHr: 77,
      tier: 'basic',
      fps: 30,
      labels: { rhythm: 'sinus', firstReading: true },
      reading: { metrics: { hr: { value: 80 }, rhythm: { flag: 'irregular' } } },
    }),
    capture({
      subject: 'P3',
      hr: 99,
      polarHr: 60,
      labels: { deliberateArtifact: true, firstReading: true },
      reading: { headlineKey: 'result.inconclusive' },
    }),
  ];
  const metrics = computeMetrics(captures, { commit: 'abc', date: '2026-10-20' });
  assert.equal(metrics.polarPairedCaptures, 4);
  assert.equal(metrics.hr.readings, 3);
  assert.equal(metrics.hr.people, 3);
  assert.equal(metrics.hr.maeBpm, 2);
  assert.equal(metrics.intervals.maeMs, 10);
  assert.deepEqual(metrics.rmssd, { withinPct: 100, people: 2 });
  assert.deepEqual(metrics.ml5, { sinusReadings: 3, falseIrregular: 1 });
  assert.deepEqual(metrics.ux1, { firstReadings: 3, conclusive: 2 });
  assert.deepEqual(metrics.artifactCaptures, { total: 1, rejectedOrInconclusive: 1 });
  assert.deepEqual(
    metrics.perTier.map((row) => [row.tier, row.phones, row.hrMaeBpm]),
    [
      ['basic', 1, 3],
      ['full', 1, 1.5],
    ],
  );
  assert.deepEqual(metrics.recompute, { agent: null, matches: null });
});

function writeCaptureFolder(root, name, { processed }) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  const meta = {
    modelId: 'iphone',
    fps: 60,
    rating: { score: 86, tier: 'full' },
    subject: { code: name },
    labels: {},
  };
  fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(
    path.join(folder, 'polar_rr.csv'),
    `t_ns,rr_ms\n${sequence(30)
      .map((value, i) => `${i},${value}`)
      .join('\n')}\n`,
  );
  if (!processed) return;
  fs.writeFileSync(
    path.join(folder, 'replay-result.json'),
    JSON.stringify({ headlineKey: 'result.regular', metrics: { hr: { value: 75 } } }),
  );
  fs.writeFileSync(
    path.join(folder, 'replay-intervals.csv'),
    `t_ns,ibi_ms,accepted\n${sequence(30)
      .map((value, i) => `${i},${value},${i === 5 ? 0 : 1}`)
      .join('\n')}\n`,
  );
}

test('folders without a replay result are skipped, and rejected beats are dropped', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeCaptureFolder(root, 'P1', { processed: true });
  writeCaptureFolder(root, 'P2', { processed: false });
  const { captures, missing } = readCaptures(root);
  assert.deepEqual(missing, ['P2']);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].phoneRrMs.length, 29);
  assert.equal(captures[0].polarRrMs.length, 30);
});

test('the CLI writes metrics.json and fails without captures', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-replay-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeCaptureFolder(path.join(root, 'captures'), 'P1', { processed: true });
  const out = path.join(root, 'metrics.json');
  const run = spawnSync(process.execPath, [CLI, '--captures', path.join(root, 'captures'), '--out', out], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).hr.readings, 1);
  const empty = spawnSync(process.execPath, [CLI, '--captures', path.join(root, 'nowhere')], {
    encoding: 'utf8',
  });
  assert.equal(empty.status, 1);
});
