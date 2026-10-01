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
import { mean, rmssd, subjectBootstrap } from './eval-replay/stats.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'eval-replay.mjs');

// A deterministic, irregular-enough interval sequence (ms) so cross-correlation has a clear peak.
// A seeded, non-periodic interval series (ms) like resting heart-rate variability: a slow wander plus
// beat-to-beat noise, so only the true lag lines the two sequences up.
function sequence(length) {
  let state = 7;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648 - 0.5;
  };
  let wander = 0;
  return Array.from({ length }, () => {
    wander = 0.8 * wander + 40 * random();
    return 800 + wander + 30 * random();
  });
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('alignment finds positive and negative beat lags', () => {
  const polar = sequence(60);
  const later = alignIntervals(
    polar.slice(3, 50).map((value) => value + 4),
    polar,
  );
  assert.equal(later.lag, 3);
  assert.ok(later.correlation > 0.99);
  const earlier = alignIntervals(polar, polar.slice(4, 56));
  assert.equal(earlier.lag, -4);
});

// The phone saw strap intervals 4..53, so phone interval p is strap interval p + 4 until a count error.
const pairFor = (alignment, phoneIndex) => alignment.pairs.find(([p]) => p === phoneIndex)?.[1];

test('a misplaced rejected beat in the middle does not shift the alignment', () => {
  const polar = sequence(60);
  const phone = polar.slice(4, 54);
  phone[20] += 400;
  phone[21] -= 400;
  const alignment = alignIntervals(phone, polar, (p) => p !== 20 && p !== 21);
  assert.equal(alignment.lag, 4);
  assert.equal(pairFor(alignment, 30), 34);
});

test('a missed phone beat (two intervals merged) does not shift later pairs', () => {
  const polar = sequence(60);
  const phone = polar.slice(4, 54);
  phone.splice(20, 2, phone[20] + phone[21]);
  const alignment = alignIntervals(phone, polar, (p) => p !== 20);
  assert.equal(pairFor(alignment, 10), 14);
  assert.equal(pairFor(alignment, 20), undefined);
  assert.equal(pairFor(alignment, 30), 35);
});

test('an extra phone beat (one interval split) does not shift later pairs', () => {
  const polar = sequence(60);
  const phone = polar.slice(4, 54);
  phone.splice(20, 1, phone[20] / 2, phone[20] / 2);
  const alignment = alignIntervals(phone, polar, (p) => p !== 20 && p !== 21);
  assert.equal(pairFor(alignment, 10), 14);
  assert.equal(pairFor(alignment, 20), undefined);
  assert.equal(pairFor(alignment, 21), undefined);
  assert.equal(pairFor(alignment, 30), 33);
});

test('alignment refuses short sequences and poor correlation', () => {
  assert.equal(alignIntervals(sequence(5), sequence(5)), null);
  const flatPhone = Array.from({ length: 40 }, (_, i) => 800 + (i % 2));
  assert.equal(alignIntervals(flatPhone, sequence(40)), null);
});

test('RMSSD skips differences next to an unusable beat', () => {
  assert.equal(rmssd([800, 810, 790, 800]), Math.sqrt((100 + 400 + 100) / 3));
  assert.equal(
    rmssd([800, 810, 2500, 800, 790], [true, true, false, true, true]),
    Math.sqrt((100 + 100) / 2),
  );
  assert.equal(rmssd([800, 2500], [true, false]), null);
});

test('every subject counts equally, and one subject has no interval', () => {
  const rows = [1, 1, 1, 1, 1].map((value) => ({ subject: 'P1', value })).concat({ subject: 'P2', value: 9 });
  const two = subjectBootstrap(rows);
  assert.equal(two.value, 5);
  assert.deepEqual(subjectBootstrap(rows), two);
  // With two subjects the only possible resampled means are 1, 5 and 9.
  assert.ok(two.ci95[0] >= 1 && two.ci95[1] <= 9 && two.ci95[0] < two.ci95[1]);
  assert.deepEqual(subjectBootstrap([{ subject: 'P1', value: 3 }]), { value: 3, ci95: null });
  assert.deepEqual(subjectBootstrap([]), { value: null, ci95: null });
});

// Strap intervals scaled to an exact mean HR. The phone sees them 2 beats late with ±10 ms jitter (beat
// times can't drift, so the errors alternate), and one misplaced beat makes a long interval followed by a
// short one, both rejected by the pipeline.
function capture({
  subject,
  hr,
  polarHr,
  tier = 'full',
  fps = 60,
  labels = {},
  reading = {},
  mode = 'full',
}) {
  const raw = sequence(40);
  const polarRrMs = raw.map((value) => (value * 60000) / mean(raw) / polarHr);
  const phone = polarRrMs
    .slice(2, 38)
    .map((value, i) => ({ ibiMs: value + (i % 2 ? -10 : 10), accepted: true }));
  phone[15] = { ibiMs: phone[15].ibiMs + 300, accepted: false };
  phone[16] = { ibiMs: phone[16].ibiMs - 300, accepted: false };
  const reference = rmssd(polarRrMs.slice(2, 38));
  return {
    folder: `${subject}-${hr}`,
    meta: {
      modelId: `phone-${tier}`,
      fps,
      mode,
      rating: { score: 80, tier },
      subject: { code: subject },
      labels,
    },
    reading: {
      headlineKey: 'result.regular',
      metrics: { hr: { value: hr }, rmssd: { value: reference * 1.05 }, rhythm: { flag: null } },
      ...reading,
    },
    polarRrMs,
    phone,
  };
}

test('metrics follow Appendix B and ADR 0037', () => {
  const captures = [
    capture({ subject: 'P1', hr: 62, polarHr: 60, labels: { rhythm: 'sinus', firstReading: true } }),
    capture({ subject: 'P1', hr: 64, polarHr: 60, labels: { rhythm: 'sinus' } }),
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
    capture({
      subject: 'P4',
      hr: 90,
      polarHr: 60,
      labels: { pacedBrpm: 12 },
      reading: { metrics: { hr: { value: 90 }, resp: { value: 13.5 } } },
    }),
  ];
  const logged = [];
  const metrics = computeMetrics(captures, { commit: 'abc', date: '2026-10-20' }, (line) =>
    logged.push(line),
  );
  assert.match(logged.join('\n'), /^P1-62: lag 2 beats, r 0\.\d{3}$/m);
  assert.equal(metrics.polarPairedCaptures, 6);
  // At rest only (the paced and artifact sessions are left out); P1's two readings average to 3.
  assert.equal(metrics.hr.readings, 4);
  assert.equal(metrics.hr.people, 3);
  assert.equal(metrics.hr.maeBpm, round2((3 + 1 + 3) / 3));
  assert.equal(metrics.intervals.maeMs, 10);
  assert.deepEqual(metrics.rmssd, { withinPct: 100, people: 2 });
  assert.deepEqual(metrics.resp, { maeBrpm: 1.5, people: 1 });
  assert.deepEqual(metrics.ml5, { sinusReadings: 4, falseIrregular: 1 });
  assert.deepEqual(metrics.ux1, { firstReadings: 3, conclusive: 2 });
  assert.deepEqual(metrics.artifactCaptures, { total: 1, rejectedOrInconclusive: 1 });
  assert.deepEqual(metrics.perTier, [
    { tier: 'basic', phones: 1, hrMaeBpm: 3, intervalMaeMs: 10 },
    { tier: 'full', phones: 1, hrMaeBpm: 2, intervalMaeMs: 10 },
  ]);
  assert.deepEqual(metrics.recompute, { agent: null, matches: null });
});

function round2(value) {
  return Math.round(value * 100) / 100;
}

function writeCaptureFolder(root, name, { processed = true, polarCsv, intervals = true } = {}) {
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
  fs.writeFileSync(path.join(folder, 'samples.csv'), 't_ns,r,g,b\n5,0.5,0.1,0.1\n25,0.5,0.1,0.1\n');
  const rows = sequence(30).map((value, i) => `${i},${value}`);
  fs.writeFileSync(path.join(folder, 'polar_rr.csv'), polarCsv ?? `t_ns,rr_ms\n${rows.join('\n')}\n`);
  if (!processed) return;
  fs.writeFileSync(
    path.join(folder, 'replay-result.json'),
    JSON.stringify({ headlineKey: 'result.regular', metrics: { hr: { value: 75 } } }),
  );
  if (intervals)
    fs.writeFileSync(
      path.join(folder, 'replay-intervals.csv'),
      `t_ns,ibi_ms,accepted\n${sequence(30)
        .map((value, i) => `${i},${value},${i === 5 ? 0 : 1}`)
        .join('\n')}\n`,
    );
}

test('captures keep rejected beats in order and use only strap beats inside the capture', (t) => {
  const root = tempDir(t);
  writeCaptureFolder(root, 'P1');
  writeCaptureFolder(root, 'P2', { processed: false });
  const { captures, missing } = readCaptures(root);
  assert.deepEqual(missing, ['P2']);
  assert.equal(captures[0].phone.length, 30);
  assert.equal(captures[0].phone[5].accepted, false);
  // samples.csv spans t_ns 5..25, so strap rows 5..25 remain.
  assert.equal(captures[0].polarRrMs.length, 21);
});

test('malformed or missing files stop the run with the folder name', (t) => {
  const badHeader = tempDir(t);
  writeCaptureFolder(badHeader, 'P1', { polarCsv: 'time,rr\n1,800\n' });
  assert.throws(() => readCaptures(badHeader), /P1.polar_rr\.csv: expected columns t_ns,rr_ms/);
  const badValue = tempDir(t);
  writeCaptureFolder(badValue, 'P1', { polarCsv: 't_ns,rr_ms\n1,eight hundred\n' });
  assert.throws(() => readCaptures(badValue), /row 2 has a bad rr_ms/);
  const noIntervals = tempDir(t);
  writeCaptureFolder(noIntervals, 'P1', { intervals: false });
  assert.throws(() => readCaptures(noIntervals), /no replay-intervals\.csv/);
  const otherClock = tempDir(t);
  writeCaptureFolder(otherClock, 'P1', { polarCsv: 't_ns,rr_ms\n900000,800\n900800,810\n' });
  assert.throws(
    () => readCaptures(otherClock),
    /polar_rr\.csv t_ns 900000\.\.900800 does not overlap samples\.csv 5\.\.25/,
  );
});

test('the CLI writes metrics.json and fails without captures', (t) => {
  const root = tempDir(t);
  writeCaptureFolder(path.join(root, 'captures'), 'P1');
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
