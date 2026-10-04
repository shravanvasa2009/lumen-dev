import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { replayFolder } from '../src/replay.mjs';
import { writeSyntheticCapture } from './synthetic-capture.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-replay-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function readIntervals(folder) {
  const [header, ...rows] = fs
    .readFileSync(path.join(folder, 'replay-intervals.csv'), 'utf8')
    .trimEnd()
    .split('\n');
  return { header, rows: rows.map((row) => row.split(',')) };
}

describe('replay on a clean synthetic capture (CLI end to end)', () => {
  const folder = path.join(scratch, 'sinus');
  let truth;
  let written;
  before(() => {
    truth = writeSyntheticCapture(folder, { seconds: 95, bpm: 75 });
    const run = spawnSync(process.execPath, [CLI, folder], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    written = JSON.parse(fs.readFileSync(path.join(folder, 'replay-result.json'), 'utf8'));
  });

  it('writes the ReadingResult with its outcome, coreCommit, configHash, and inconclusive', () => {
    assert.deepEqual(Object.keys(written), [
      'headlineKey',
      'cleanSeconds',
      'beats',
      'rejectedBeats',
      'metrics',
      'experimental',
      'lostSeconds',
      'notChecked',
      'outcome',
      'coreCommit',
      'configHash',
      'inconclusive',
      'rhythmSource',
    ]);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    assert.equal(written.coreCommit, head);
    const bytes = fs.readFileSync(path.join(REPO_ROOT, 'ml', 'lumen_dsp', 'dsp_config.json'));
    assert.equal(written.configHash, `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`);
    assert.equal(written.inconclusive, false);
    assert.equal(written.outcome.kind, 'reading');
  });

  it('reads the heart rate within 1 bpm, with no model outputs and the repo evidence file', () => {
    assert.ok(Math.abs(written.metrics.hr.value - 75) < 1, `HR ${written.metrics.hr.value}`);
    assert.equal(written.metrics.hr.evidence, 'experimental');
    assert.equal(written.metrics.rhythm, null);
    assert.equal(written.metrics.diabetes, null);
    // No rhythm model in replay: the headline cannot claim a regular rhythm.
    assert.equal(written.headlineKey, 'result.uncertain');
  });

  it('writes replay-intervals.csv with the contract columns, one row per interval, in time order', () => {
    const { header, rows } = readIntervals(folder);
    assert.equal(header, 't_ns,ibi_ms,accepted,nn');
    assert.ok(rows.length >= truth.peaksS.filter((peakS) => peakS > 1 && peakS < 69).length - 2);
    let previous = 0;
    for (const [tNs, ibiMs, accepted, nn] of rows) {
      assert.match(tNs, /^\d+$/);
      assert.ok(Number(tNs) > previous);
      previous = Number(tNs);
      assert.ok(['0', '1'].includes(accepted) && ['0', '1'].includes(nn));
      if (accepted === '1') assert.ok(Math.abs(Number(ibiMs) - 800) < 5, `ibi ${ibiMs}`);
    }
    // Each t_ns is the peak of a true beat on the capture clock, within 10 ms.
    for (const [tNs] of rows) {
      const tS = (Number(tNs) - truth.startNs) / 1e9;
      assert.ok(Math.min(...truth.peaksS.map((peakS) => Math.abs(peakS - tS))) < 0.01);
    }
  });
});

describe('replayFolder', () => {
  it('refuses a capture with no finger per readingOutcome: its outcome only, no ReadingResult', async () => {
    const folder = path.join(scratch, 'finger-off');
    writeSyntheticCapture(folder, { seconds: 30, fingerOff: true });
    const { output } = await replayFolder(folder);
    assert.deepEqual(Object.keys(output), [
      'outcome',
      'coreCommit',
      'configHash',
      'inconclusive',
      'rhythmSource',
    ]);
    assert.equal(output.outcome.kind, 'inconclusive');
    assert.equal(output.inconclusive, true);
    assert.ok(output.outcome.cleanSeconds < output.outcome.neededCleanSeconds);
  });

  it('refuses a clean capture shorter than its mode needs, and still writes its intervals', async () => {
    const folder = path.join(scratch, 'too-short');
    writeSyntheticCapture(folder, { seconds: 20, bpm: 75 });
    const { output } = await replayFolder(folder);
    assert.equal(output.outcome.kind, 'inconclusive');
    assert.equal(output.inconclusive, true);
    assert.ok(readIntervals(folder).rows.length > 0);
  });

  it('infers the capture rate and treats the phone as unrated when meta.json lacks them', async () => {
    const folder = path.join(scratch, 'lab-meta');
    writeSyntheticCapture(folder, { seconds: 40, fps: 30, meta: { fps: undefined, rating: undefined } });
    const { context } = await replayFolder(folder);
    assert.equal(context.captureFps, 30);
    assert.equal(context.tier, null);
  });

  it('without --rhythm-from-label: rhythmSource "none" and no RMSSD', async () => {
    const folder = path.join(scratch, 'no-label-flag');
    writeSyntheticCapture(folder, { seconds: 95, meta: { labels: { rhythm: 'sinus' } } });
    const { output } = await replayFolder(folder);
    assert.equal(output.rhythmSource, 'none');
    assert.equal(output.metrics.rmssd, null);
  });

  it('with --rhythm-from-label: the label opens the DSP-12 gate, but no rhythm card appears', async () => {
    const folder = path.join(scratch, 'label-flag');
    writeSyntheticCapture(folder, { seconds: 95, meta: { labels: { rhythm: 'sinus' } } });
    const { output } = await replayFolder(folder, { rhythmFromLabel: true });
    assert.equal(output.rhythmSource, 'label');
    assert.ok(output.metrics.rmssd.value >= 0);
    assert.equal(output.metrics.rhythm, null);
    assert.equal(output.headlineKey, 'result.uncertain');
    assert.deepEqual(Object.keys(output).slice(-4), [
      'coreCommit',
      'configHash',
      'inconclusive',
      'rhythmSource',
    ]);
  });

  it('with --rhythm-from-label: refuses a capture without a known rhythm label', async () => {
    const folder = path.join(scratch, 'label-missing');
    writeSyntheticCapture(folder, { seconds: 20 });
    await assert.rejects(replayFolder(folder, { rhythmFromLabel: true }), /labels\.rhythm/);
    writeSyntheticCapture(folder, { seconds: 20, meta: { labels: { rhythm: 'bigeminy' } } });
    await assert.rejects(replayFolder(folder, { rhythmFromLabel: true }), /labels\.rhythm/);
  });

  it('the CLI passes --rhythm-from-label through', () => {
    const folder = path.join(scratch, 'label-cli');
    writeSyntheticCapture(folder, { seconds: 95, meta: { labels: { rhythm: 'sinus' } } });
    const run = spawnSync(process.execPath, [CLI, '--rhythm-from-label', folder], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(folder, 'replay-result.json'), 'utf8'));
    assert.equal(written.rhythmSource, 'label');
  });

  it('refuses a folder whose stats rows do not match the samples', async () => {
    const folder = path.join(scratch, 'mismatch');
    writeSyntheticCapture(folder, { seconds: 10 });
    const stats = path.join(folder, 'stats.csv');
    fs.writeFileSync(stats, fs.readFileSync(stats, 'utf8').split('\n').slice(0, -2).join('\n'));
    await assert.rejects(replayFolder(folder), RangeError);
  });

  it('refuses a CSV with the wrong header', async () => {
    const folder = path.join(scratch, 'bad-header');
    writeSyntheticCapture(folder, { seconds: 10 });
    const samples = path.join(folder, 'samples.csv');
    fs.writeFileSync(samples, fs.readFileSync(samples, 'utf8').replace('t_ns,r,g,b', 't,r,g,b'));
    await assert.rejects(replayFolder(folder), /samples\.csv/);
  });
});
