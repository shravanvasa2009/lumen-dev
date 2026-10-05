import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { diagnoseFolder, formatReport } from '../src/diagnose.mjs';
import { writeSyntheticCapture } from './synthetic-capture.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-diagnose-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// A budget Android with auto-exposure unlocked (owner's phone test 1): the reported exposure changes once a second.
function withHuntingExposure(folder) {
  const file = path.join(folder, 'stats.csv');
  const [header, ...rows] = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  const changed = rows.map((row, k) => {
    const [tNs, spatialStdR, clipFrac] = row.split(',');
    return `${tNs},${spatialStdR},${clipFrac},${8_000_000 + 100_000 * Math.floor(k / 30)}`;
  });
  fs.writeFileSync(file, `${[header, ...changed].join('\n')}\n`);
}

// Sets every frame's spatial spread and clip fraction (stats.csv columns 2 and 3).
function withFrameStats(folder, spatialStdR, clipFrac) {
  const file = path.join(folder, 'stats.csv');
  const [header, ...rows] = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  const changed = rows.map((row) => {
    const [tNs, , , exposureNs] = row.split(',');
    return `${tNs},${spatialStdR},${clipFrac},${exposureNs}`;
  });
  fs.writeFileSync(file, `${[header, ...changed].join('\n')}\n`);
}

describe('diagnose: where the heart rate goes wrong in a capture', () => {
  it('a clean capture: every rate within 5 bpm of the reference, nothing lost', async () => {
    const folder = path.join(scratch, 'clean');
    writeSyntheticCapture(folder, { seconds: 95, bpm: 75 });
    const report = await diagnoseFolder(folder, { referenceBpm: 75 });
    assert.equal(report.outcome.kind, 'reading');
    for (const bpm of [report.rates.saved, report.rates.liveMedian, report.rates.spectral])
      assert.ok(Math.abs(bpm - 75) <= 5, `${bpm}`);
    assert.deepEqual(report.clean.lostByReason, {});
    assert.equal(report.capture.exposureValues, 1);
  });

  it('auto-exposure hunting: DSP-5 is named as the stage that refuses a pulse the light signal carries', async () => {
    const folder = path.join(scratch, 'ae');
    writeSyntheticCapture(folder, { seconds: 95, fps: 30, bpm: 75 });
    withHuntingExposure(folder);
    const report = await diagnoseFolder(folder, { referenceBpm: 75 });
    assert.equal(report.outcome.kind, 'inconclusive');
    assert.ok(report.clean.lostByReason.exposure > 90);
    assert.ok(Math.abs(report.rates.spectral - 75) <= 5);
    assert.ok(report.verdicts.some((line) => line.includes('auto-exposure is not locked')));
    assert.ok(report.verdicts.some((line) => line.includes('the rate is lost after the camera, in DSP-5')));
    assert.ok(!report.verdicts.some((line) => line.includes('first problem: the light signal')));
    assert.match(formatReport(report), /Exposure {2}95 values, 94 changes/);
  });

  it('a dicrotic pulse whose 2nd harmonic is strongest: the pulse is present, beat detection is named', async () => {
    const folder = path.join(scratch, 'dicrotic');
    writeSyntheticCapture(folder, { seconds: 95, bpm: 50, secondWave: 1 });
    const report = await diagnoseFolder(folder, { referenceBpm: 50 });
    assert.ok(Math.abs(report.rates.spectral - 100) <= 5, `${report.rates.spectral}`);
    assert.ok(
      report.verdicts.some((line) => line.includes("the spectral peak is on the pulse's 2nd harmonic")),
    );
    assert.ok(!report.verdicts.some((line) => line.includes('first problem: the light signal')));
    // An equal second wave half a period later is a beat to DSP-7 too: 100 for a 50 bpm pulse.
    assert.ok(Math.abs(report.rates.saved - 100) <= 5, `${report.rates.saved}`);
    assert.ok(report.verdicts.some((line) => line.includes('each beat found twice')));
    assert.ok(report.verdicts.some((line) => line.includes('in beat detection (DSP-7/9)')));
  });

  it('a saturated finger still counts as covered: clipping is counted apart from contact (DSP-4)', async () => {
    const folder = path.join(scratch, 'clipped');
    writeSyntheticCapture(folder, { seconds: 40, bpm: 70 });
    withFrameStats(folder, 0.02, 0.1);
    const report = await diagnoseFolder(folder, { referenceBpm: 70 });
    assert.equal(report.contact.uncovered, 0);
    assert.equal(report.contact.clipped, report.capture.frames);
    assert.equal(report.contact.clippedButCovered, report.capture.frames);
  });

  it('a wide red gradient across the region fails contact, and the verdict names the spatial spread test', async () => {
    const folder = path.join(scratch, 'spread');
    writeSyntheticCapture(folder, { seconds: 40, bpm: 70 });
    withFrameStats(folder, 0.2, 0);
    const report = await diagnoseFolder(folder, { referenceBpm: 70 });
    assert.equal(report.contact.uncovered, report.capture.frames);
    assert.equal(report.contact.failed.spatialSpread, report.capture.frames);
    assert.ok(report.verdicts.some((line) => line.includes('mostly the spatialSpread test')));
  });

  it('without a reference it asks for one instead of judging the rates', async () => {
    const folder = path.join(scratch, 'noref');
    writeSyntheticCapture(folder, { seconds: 40, bpm: 60 });
    const report = await diagnoseFolder(folder);
    assert.equal(report.rates.reference, null);
    assert.ok(report.verdicts.some((line) => line.includes('pass --ref')));
  });
});
