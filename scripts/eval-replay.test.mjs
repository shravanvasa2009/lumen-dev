import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { alignIntervals } from './eval-replay/align.mjs';
import { readCaptures } from './eval-replay/captures.mjs';
import { buildEvidence, decidePasses } from './eval-replay/evidence.mjs';
import { computeMetrics } from './eval-replay/metrics.mjs';
import { compareMetrics } from './eval-replay/recompute.mjs';
import { mean, median, rmssd, subjectBootstrap } from './eval-replay/stats.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'eval-replay.mjs');

// A seeded, non-periodic interval series (ms) like resting heart-rate variability: a slow wander (weight
// `memory`) plus beat-to-beat noise, so only the true lag lines the two sequences up.
function sequence(length, { memory = 0.8, wanderMs = 40, noiseMs = 30 } = {}) {
  let state = 7;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648 - 0.5;
  };
  let wander = 0;
  return Array.from({ length }, () => {
    wander = memory * wander + wanderMs * random();
    return 800 + wander + noiseMs * random();
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
    polar.slice(3, 50).map((value, i) => value + (i % 2 ? -4 : 4)),
    polar,
  );
  assert.equal(later.lag, 3);
  assert.ok(later.correlation > 0.95);
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

test('a smooth resting rhythm with an early missed beat still pairs every beat with its own heartbeat', () => {
  // Strong beat-to-beat memory and little noise: successive intervals differ by only ~15 ms, so a
  // one-beat-off offset also lands every beat within the match window.
  const polar = sequence(110, { memory: 0.95, wanderMs: 20, noiseMs: 4 });
  const phone = polar.slice(4, 104);
  phone.splice(30, 2, phone[30] + phone[31]);
  const alignment = alignIntervals(phone, polar, (p) => p !== 30);
  const compared = alignment.pairs.filter(([p]) => p !== 30);
  assert.ok(compared.length > 90);
  assert.ok(compared.every(([p, q]) => phone[p] === polar[q]));
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

test('the CI does not depend on the order the readings arrive in', () => {
  const rows = ['P4', 'P1', 'P3', 'P2', 'P5', 'P1'].map((subject, i) => ({
    subject,
    value: [5, 1, 4, 2, 6, 3][i],
  }));
  assert.deepEqual(subjectBootstrap([...rows].reverse()), subjectBootstrap(rows));
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
  assert.deepEqual(metrics.rmssd, { withinPct: 100, medianErrorPct: 5, people: 2 });
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

const metricsFixture = () => ({
  polarPairedCaptures: 30,
  hr: { maeBpm: 2.41, ci95: [1.9, 2.95], people: 10, readings: 30, phones: 1 },
  intervals: { maeMs: 14.2, ci95: [11.1, 17.6] },
  rmssd: { withinPct: 80, medianErrorPct: 6.5, people: 10 },
  resp: { maeBrpm: null, people: 0 },
  artifactCaptures: { total: 5, rejectedOrInconclusive: 5 },
  ux1: { firstReadings: 10, conclusive: 9 },
  ml5: { sinusReadings: 28, falseIrregular: 1 },
  perTier: [{ tier: 'full', phones: 1, hrMaeBpm: 2.41, intervalMaeMs: 14.2 }],
  recompute: { agent: null, matches: null },
});
const differencesWith = (change) => {
  const independent = metricsFixture();
  change(independent);
  return compareMetrics(metricsFixture(), independent).differences;
};

test('VER-1: values may differ by one rounding step (0.01) and no more', () => {
  assert.deepEqual(
    differencesWith((m) => (m.hr.maeBpm = 2.42)),
    [],
  );
  assert.deepEqual(
    differencesWith((m) => (m.hr.maeBpm = 2.43)),
    ['hr.maeBpm: 2.41 vs 2.43'],
  );
  assert.deepEqual(
    differencesWith((m) => (m.intervals.ci95 = [11.1, 17.62])),
    ['intervals.ci95: [11.1,17.6] vs [11.1,17.62]'],
  );
});

// One rounding step can still straddle a pass line (3.00 vs 3.01); anything wider can't count as a match.
test('VER-1: results more than a rounding step apart across the DSP-A line do not match', () => {
  const below = metricsFixture();
  const above = metricsFixture();
  below.hr.maeBpm = 2.95;
  above.hr.maeBpm = 3.04;
  assert.equal(compareMetrics(below, above).matches, false);
});

test('VER-1: counts must be equal integers, and nulls must be on both sides', () => {
  assert.deepEqual(
    differencesWith((m) => (m.hr.people = 10.05)),
    ['hr.people: 10 vs 10.05'],
  );
  assert.deepEqual(
    differencesWith((m) => (m.hr.maeBpm = '2.41')),
    ['hr.maeBpm: 2.41 vs "2.41"', 'passed.hr: true vs false'],
  );
  assert.deepEqual(
    differencesWith((m) => {
      m.polarPairedCaptures = 29;
      m.hr.phones = 2;
      m.resp.people = 1;
      m.resp.maeBrpm = 1.2;
    }),
    [
      'polarPairedCaptures: 30 vs 29',
      'hr.phones: 1 vs 2',
      'resp.people: 0 vs 1',
      'resp.maeBrpm: null vs 1.2',
    ],
  );
  assert.deepEqual(
    differencesWith((m) => m.perTier.push({ tier: 'basic', phones: 1, hrMaeBpm: 3, intervalMaeMs: 20 })),
    ['perTier.basic: only in the independent metrics'],
  );
});

test('VER-1: the CLI records the recompute and fails on a mismatch or bad input', (t) => {
  const root = tempDir(t);
  const out = path.join(root, 'metrics.json');
  const independent = path.join(root, 'independent.json');
  fs.writeFileSync(out, JSON.stringify(metricsFixture()));
  fs.writeFileSync(independent, JSON.stringify(metricsFixture()));
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args, '--out', out], { encoding: 'utf8' });
  assert.equal(run('--recompute', independent).status, 1);
  assert.match(run('--agent', 'second-agent', '--recompute').stderr, /not found/);
  assert.match(
    run('--recompute', path.join(root, 'none.json'), '--agent', 'a').stderr,
    /none\.json not found/,
  );
  assert.equal(run('--recompute', independent, '--agent', 'second-agent').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).recompute, {
    agent: 'second-agent',
    matches: true,
    differences: [],
  });
  fs.writeFileSync(
    independent,
    JSON.stringify({ ...metricsFixture(), hr: { ...metricsFixture().hr, maeBpm: 3.1 } }),
  );
  const mismatch = run('--recompute', independent, '--agent', 'second-agent');
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /hr\.maeBpm: 2\.41 vs 3\.1/);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).recompute.matches, false);
  fs.writeFileSync(independent, '{}');
  assert.match(run('--recompute', independent, '--agent', 'a').stderr, /no perTier list/);
});

test('the median RMSSD error is the middle reading, or the mean of the two middle ones', () => {
  assert.equal(median([12, 3, 7]), 7);
  assert.equal(median([4, 1, 9, 2]), 3);
});

const passesWith = (change) => {
  const metrics = metricsFixture();
  change(metrics);
  return decidePasses(metrics);
};

test('ADR 0044: DSP-A passes at 3 bpm or less with at least 10 people', () => {
  assert.equal(decidePasses(metricsFixture()).hr, true);
  assert.equal(passesWith((m) => (m.hr.maeBpm = 3)).hr, true);
  assert.equal(passesWith((m) => (m.hr.maeBpm = 3.01)).hr, false);
  assert.equal(passesWith((m) => (m.hr.people = 9)).hr, false);
  assert.equal(passesWith((m) => (m.hr.maeBpm = null)).hr, false);
  assert.equal(passesWith((m) => (m.hr.ci95 = null)).hr, false);
});

test('ADR 0044: DSP-B needs interval MAE ≤ 25 ms, median RMSSD error ≤ 10% and 10 people', () => {
  assert.equal(decidePasses(metricsFixture()).hrv, true);
  assert.equal(passesWith((m) => (m.intervals.maeMs = 25)).hrv, true);
  assert.equal(passesWith((m) => (m.intervals.maeMs = 25.01)).hrv, false);
  assert.equal(passesWith((m) => (m.rmssd.medianErrorPct = 10)).hrv, true);
  assert.equal(passesWith((m) => (m.rmssd.medianErrorPct = 10.01)).hrv, false);
  assert.equal(passesWith((m) => (m.rmssd.medianErrorPct = null)).hrv, false);
  assert.equal(passesWith((m) => (m.rmssd.people = 9)).hrv, false);
  assert.equal(passesWith((m) => (m.intervals.ci95 = null)).hrv, false);
});

test('ADR 0044: RESP-1 needs MAE strictly below 2 breaths/min and 10 people', () => {
  assert.equal(decidePasses(metricsFixture()).resp, false);
  assert.equal(passesWith((m) => (m.resp = { maeBrpm: 1.99, people: 10 })).resp, true);
  assert.equal(passesWith((m) => (m.resp = { maeBrpm: 2, people: 10 })).resp, false);
  assert.equal(passesWith((m) => (m.resp = { maeBrpm: 1.2, people: 9 })).resp, false);
});

test('VER-1: values within a rounding step that straddle a pass line do not match', () => {
  const onLine = metricsFixture();
  onLine.hr.maeBpm = 3;
  const over = metricsFixture();
  over.hr.maeBpm = 3.01;
  assert.deepEqual(compareMetrics(onLine, over).differences, ['passed.hr: true vs false']);
});

const seedEvidence = () => ({
  commit: null,
  date: null,
  metrics: {
    hr: { label: 'experimental', passed: false },
    rhythm: { label: 'public-data', dataset: 'MIMIC PERform AF', subjects: 35, passed: true },
    hrv: { label: 'experimental', passed: false },
    resp: { label: 'experimental', passed: false },
    diabetes: { label: 'experimental', passed: false },
    extraBeats: { label: 'experimental', passed: false },
  },
});

test('evidence.json gets labels from the pass rules and keeps the model evidence', () => {
  const evidence = buildEvidence({ ...metricsFixture(), commit: 'abc', date: '2026-10-20' }, seedEvidence());
  assert.equal(evidence.commit, 'abc');
  assert.equal(evidence.date, '2026-10-20');
  assert.deepEqual(evidence.metrics.hr, {
    label: 'checked',
    reference: 'Polar H10',
    maeBpm: 2.41,
    ci95: [1.9, 2.95],
    people: 10,
    phones: 1,
    criterion: 'DSP-A',
    passed: true,
  });
  assert.deepEqual(evidence.metrics.hrv, {
    label: 'checked',
    reference: 'Polar H10',
    withinPct: 80,
    medianErrorPct: 6.5,
    intervalMaeMs: 14.2,
    ci95: [11.1, 17.6],
    people: 10,
    criterion: 'DSP-B',
    passed: true,
  });
  assert.deepEqual(evidence.metrics.resp, {
    label: 'experimental',
    reference: 'metronome',
    maeBrpm: null,
    people: 0,
    criterion: 'RESP-1',
    passed: false,
  });
  for (const key of ['rhythm', 'diabetes', 'extraBeats'])
    assert.deepEqual(evidence.metrics[key], seedEvidence().metrics[key]);
});

test('the CLI writes evidence.json and the app copy only after a matching recompute', (t) => {
  const root = tempDir(t);
  const metricsFile = path.join(root, 'metrics.json');
  const out = path.join(root, 'evidence.json');
  const app = path.join(root, 'assets', 'evidence.json');
  const run = () =>
    spawnSync(process.execPath, [CLI, '--evidence', '--metrics', metricsFile, '--out', out, '--app', app], {
      encoding: 'utf8',
    });
  const metrics = { ...metricsFixture(), commit: 'abc', date: '2026-10-20' };
  fs.writeFileSync(metricsFile, JSON.stringify(metrics));
  fs.writeFileSync(out, JSON.stringify(seedEvidence()));
  const unmatched = run();
  assert.equal(unmatched.status, 1);
  assert.match(unmatched.stderr, /no matching recompute/);
  assert.equal(fs.existsSync(app), false);

  fs.writeFileSync(
    metricsFile,
    JSON.stringify({ ...metrics, recompute: { agent: 'second-agent', matches: true, differences: [] } }),
  );
  fs.rmSync(out);
  assert.match(run().stderr, /evidence\.json not found/);

  fs.writeFileSync(out, JSON.stringify(seedEvidence()));
  const written = run();
  assert.equal(written.status, 0, written.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).metrics.hr.label, 'checked');
  assert.equal(fs.readFileSync(app, 'utf8'), fs.readFileSync(out, 'utf8'));
});

// polar_rr.csv rows written the way B's Lab recorder stamps them since PR #58 (stampStrapRr in
// apps/mobile/src/dev/strapClock.ts): the strap notifies about once a second with every RR since the last
// notification; the rows form one beat timeline anchored by the least-delayed arrival, and a new stretch with
// its own anchor starts only where an arrival proves beats were lost.
function strapRows(intervalsMs, { periodMs = 1000, lost = [] } = {}) {
  const notifications = [];
  let beatMs = 0;
  let pending = [];
  let nextNotifyMs = periodMs;
  intervalsMs.forEach((rr) => {
    beatMs += rr;
    while (beatMs > nextNotifyMs) {
      const n = Math.round(nextNotifyMs / periodMs);
      // Bridge delay varies between 20 and 60 ms.
      if (pending.length && !lost.includes(n))
        notifications.push({ arrivalMs: nextNotifyMs + 20 + ((n * 7) % 5) * 10, rr: pending });
      pending = [];
      nextNotifyMs += periodMs;
    }
    pending.push(rr);
  });
  const stretches = [];
  notifications.forEach(({ arrivalMs, rr }, i) => {
    const nextRrMs = notifications[i + 1]?.rr[0] ?? rr.at(-1);
    const stretch = stretches.at(-1);
    const elapsedMs = stretch ? stretch.endsMs.at(-1) : 0;
    let endMs = elapsedMs;
    const endsMs = rr.map((value) => (endMs += value));
    const startMs = arrivalMs - endsMs.at(-1);
    if (stretch && startMs - stretch.startMs <= nextRrMs) {
      stretch.startMs = Math.min(stretch.startMs, startMs);
      stretch.endsMs.push(...endsMs);
      stretch.rr.push(...rr);
    } else {
      const ownEndsMs = endsMs.map((endMs) => endMs - elapsedMs);
      stretches.push({ startMs: arrivalMs - ownEndsMs.at(-1), endsMs: ownEndsMs, rr: [...rr] });
    }
  });
  return stretches.flatMap(({ startMs, endsMs, rr }) =>
    endsMs.map((endMs, k) => ({ t_ns: Math.round((startMs + endMs) * 1e6), rr_ms: rr[k] })),
  );
}

// One unbroken beat timeline, for checking the dropout rule on exact steps.
function timelineRows(intervalsMs) {
  let endNs = 0;
  return intervalsMs.map((rr) => ({ t_ns: (endNs += rr * 1e6), rr_ms: rr }));
}

function readStrap(t, rows) {
  const root = tempDir(t);
  writeCaptureFolder(root, 'P1');
  const folder = path.join(root, 'P1');
  fs.writeFileSync(path.join(folder, 'samples.csv'), `t_ns,r,g,b\n0,0.5,0.1,0.1\n${600e9},0.5,0.1,0.1\n`);
  fs.writeFileSync(
    path.join(folder, 'polar_rr.csv'),
    `t_ns,rr_ms\n${rows.map((row) => `${row.t_ns},${row.rr_ms}`).join('\n')}\n`,
  );
  return readCaptures(root).captures[0];
}

test('notification timing alone is never taken for a strap dropout, even at slow heart rates', (t) => {
  for (const rr of [sequence(90), sequence(60).map((value) => value * 1.9)]) {
    const capture = readStrap(t, strapRows(rr));
    assert.equal(capture.strapDropouts, 0);
    assert.equal(capture.polarRrMs.length, rr.length - 1);
  }
});

test('one lost beat at 55 bpm is a dropout', (t) => {
  const rows = timelineRows(Array.from({ length: 60 }, () => 1090));
  rows.splice(30, 1);
  assert.equal(readStrap(t, rows).strapDropouts, 1);
});

test('a late arrival tens of ms off the timeline is not a dropout', (t) => {
  const rows = timelineRows(sequence(60));
  rows.slice(30).forEach((row) => (row.t_ns += 24e6));
  assert.equal(readStrap(t, rows).strapDropouts, 0);
});

test('a strap dropout keeps only the longest unbroken stretch, so no beat pairs across it', (t) => {
  const rr = sequence(90);
  // Notifications 20–24 never arrived: about five seconds of beats are gone.
  const rows = strapRows(rr, { lost: [20, 21, 22, 23, 24] });
  const capture = readStrap(t, rows);
  assert.equal(capture.strapDropouts, 1);
  const afterGap = rows.findIndex((row, i) => i > 0 && row.t_ns - rows[i - 1].t_ns > 3e9);
  assert.deepEqual(
    capture.polarRrMs,
    rows.slice(afterGap).map((row) => row.rr_ms),
  );
});

test('the CLI warns about captures with a strap dropout', (t) => {
  const root = tempDir(t);
  writeCaptureFolder(path.join(root, 'captures'), 'P1');
  const folder = path.join(root, 'captures', 'P1');
  fs.writeFileSync(path.join(folder, 'samples.csv'), `t_ns,r,g,b\n0,0.5,0.1,0.1\n${600e9},0.5,0.1,0.1\n`);
  const rows = strapRows(sequence(90), { lost: [20, 21, 22, 23, 24] });
  fs.writeFileSync(
    path.join(folder, 'polar_rr.csv'),
    `t_ns,rr_ms\n${rows.map((row) => `${row.t_ns},${row.rr_ms}`).join('\n')}\n`,
  );
  const run = spawnSync(
    process.execPath,
    [CLI, '--captures', path.join(root, 'captures'), '--out', path.join(root, 'metrics.json')],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /P1: 1 strap dropout\(s\); only the longest unbroken stretch is used/);
});

test('after a dropout, the kept later stretch still pairs each beat with its own heartbeat', (t) => {
  const randomWalk = sequence(120);
  // Paced breathing at 6.7 breaths/min repeats every 9 beats, so a sequence match alone can lock a whole
  // breath off.
  const paced = Array.from({ length: 120 }, (_, k) => 1000 + 80 * Math.sin((2 * Math.PI * k) / 9));
  // In the paced case Lab also restarts its timeline at notification 58 without a loss: an arrival came late
  // just before a beat (strapClock.ts "Limits"). The rows then jump 773 ms, so that counts as a dropout too.
  for (const [rr, dropouts] of [
    [randomWalk, 1],
    [paced, 2],
  ]) {
    const root = tempDir(t);
    writeCaptureFolder(root, 'P1');
    const folder = path.join(root, 'P1');
    fs.writeFileSync(path.join(folder, 'samples.csv'), `t_ns,r,g,b\n0,0.5,0.1,0.1\n${600e9},0.5,0.1,0.1\n`);
    let endMs = 0;
    const phoneRows = rr.map((value, k) => {
      endMs += value;
      return `${Math.round(endMs * 1e6)},${value + (k % 2 ? -10 : 10)},1`;
    });
    fs.writeFileSync(
      path.join(folder, 'replay-intervals.csv'),
      `t_ns,ibi_ms,accepted\n${phoneRows.slice(1).join('\n')}\n`,
    );
    const rows = strapRows(rr, { lost: [12, 13, 14, 15, 16] });
    fs.writeFileSync(
      path.join(folder, 'polar_rr.csv'),
      `t_ns,rr_ms\n${rows.map((row) => `${row.t_ns},${row.rr_ms}`).join('\n')}\n`,
    );
    const { captures } = readCaptures(root);
    assert.equal(captures[0].strapDropouts, dropouts);
    assert.ok(captures[0].polarStartNs > 15e9);
    const logged = [];
    const metrics = computeMetrics(captures, { commit: 'abc', date: '2026-10-20' }, (line) =>
      logged.push(line),
    );
    assert.equal(metrics.intervals.maeMs, 10);
    // The lag is in whole-reading beats: the kept stretch starts well into the reading, so strap q = phone p + lag < 0.
    const lag = Number(/lag (-?\d+) beats/.exec(logged.join('\n'))[1]);
    assert.ok(lag < -10, `lag ${lag}`);
  }
});

test('strap data that starts after the last phone beat is not aligned at all', () => {
  const late = capture({ subject: 'P1', hr: 62, polarHr: 60 });
  late.phone = late.phone.map((beat, i) => ({ ...beat, endNs: (i + 1) * 1e9 }));
  late.polarStartNs = 1e12;
  const logged = [];
  const metrics = computeMetrics([late], { commit: 'abc', date: '2026-10-20' }, (line) => logged.push(line));
  assert.equal(metrics.intervals.maeMs, null);
  assert.match(logged.join('\n'), /did not align/);
});
