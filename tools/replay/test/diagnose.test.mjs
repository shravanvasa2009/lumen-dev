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
    assert.ok(report.verdicts.some((line) => line.includes('the pulse IS in the light signal')));
    assert.match(formatReport(report), /Exposure {2}95 values, 94 changes/);
  });

  it('without a reference it asks for one instead of judging the rates', async () => {
    const folder = path.join(scratch, 'noref');
    writeSyntheticCapture(folder, { seconds: 40, bpm: 60 });
    const report = await diagnoseFolder(folder);
    assert.equal(report.rates.reference, null);
    assert.ok(report.verdicts.some((line) => line.includes('pass --ref')));
  });
});
