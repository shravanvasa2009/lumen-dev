import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from './core.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TIERS = ['full', 'basic', 'limited'];
const RHYTHM_CLASSES = ['sinus', 'af', 'other'];
const NO_MODELS = { rhythm: null, diabetes: null };
const DEFAULT_PROFILE = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };

// Appendix B CSV with an exact header; every value must be a finite number and t_ns a safe integer.
function readCsv(folder, name, header) {
  const lines = fs
    .readFileSync(path.join(folder, name), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
  if (lines[0] !== header) throw new Error(`${name}: header must be "${header}", got "${lines[0]}"`);
  return lines.slice(1).map((line, row) => {
    const values = line.split(',').map(Number);
    if (values.length !== header.split(',').length || !values.every(Number.isFinite))
      throw new Error(`${name}: row ${row + 2} is not ${header.split(',').length} numbers`);
    if (!Number.isSafeInteger(values[0]))
      throw new Error(`${name}: row ${row + 2} t_ns is not a safe integer`);
    return values;
  });
}

function readCapture(folder) {
  const samples = readCsv(folder, 'samples.csv', 't_ns,r,g,b').map(([tNs, r, g, b]) => ({ tNs, r, g, b }));
  const stats = readCsv(folder, 'stats.csv', 't_ns,spatial_std_r,clip_frac,exposure_ns').map(
    ([tNs, spatialStdR, clipFrac, exposureNs]) => ({ tNs, spatialStdR, clipFrac, exposureNs }),
  );
  const meta = JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8'));
  return { samples, stats, meta };
}

// --rhythm-from-label (validation only, ADR 0041): meta.labels.rhythm stands in for the rhythm class in
// the DSP-12 gate. It must be one of the rhythm model's classes.
function rhythmLabel(meta) {
  const label = meta.labels?.rhythm;
  if (!RHYTHM_CLASSES.includes(label))
    throw new Error(
      `--rhythm-from-label needs meta.labels.rhythm in ${RHYTHM_CLASSES.join('/')}, got ${label}`,
    );
  return label;
}

// Lab captures (Appendix B meta) may lack fps and rating. Without fps, the format rate is taken as the
// whole number nearest the median frame rate; without a rating the phone is unrated (ADR 0041).
function contextFromMeta(meta, samples, validationRhythmLabel) {
  let captureFps = meta.fps;
  if (typeof captureFps !== 'number') {
    const gaps = samples
      .slice(1)
      .map((sample, i) => sample.tNs - samples[i].tNs)
      .sort((x, y) => x - y);
    captureFps = Math.round(1e9 / gaps[gaps.length >> 1]);
  }
  const tier = TIERS.includes(meta.rating?.tier) ? meta.rating.tier : null;
  return {
    captureFps,
    tier,
    mode: typeof meta.mode === 'string' ? meta.mode : 'quick',
    // Appendix B meta has no rest-timer field and no wall-clock time, so the resting and history rules
    // cannot fire in replay.
    restTimerDone: false,
    recordedAt: null,
    // Captures carry no accelerometer data, and SQI-Net does not run in replay (ADR 0041).
    motionSpans: [],
    coldHandsSpans: [],
    sqi: null,
    validationRhythmLabel,
  };
}

function coreCommit() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`git rev-parse HEAD gave "${sha}"`);
  return sha;
}

function configHash() {
  const bytes = fs.readFileSync(path.join(REPO_ROOT, 'ml', 'lumen_dsp', 'dsp_config.json'));
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

// replay-intervals.csv, the C/E contract: t_ns,ibi_ms,accepted,nn.
function intervalsCsv(intervals) {
  const rows = intervals.map(
    ({ tNs, ibiMs, accepted, nn }) => `${tNs},${ibiMs},${accepted ? 1 : 0},${nn ? 1 : 0}`,
  );
  return `${['t_ns,ibi_ms,accepted,nn', ...rows].join('\n')}\n`;
}

// Writes replay-result.json and replay-intervals.csv into the capture folder (Track C/E contract).
export async function replayFolder(folder, { rhythmFromLabel = false } = {}) {
  const core = await loadCore();
  const { samples, stats, meta } = readCapture(folder);
  const label = rhythmFromLabel ? rhythmLabel(meta) : null;
  const context = contextFromMeta(meta, samples, label);
  const analysis = core.analyzeReading({ samples, stats }, context);
  // readingOutcome is the refusal contract (ADR 0072): a refused capture is not a reading, so it gets
  // no ReadingResult, only its outcome. The app's Inconclusive route is to apply the same contract.
  const outcome = core.readingOutcome(analysis);
  const provenance = {
    coreCommit: coreCommit(),
    configHash: configHash(),
  };
  // What the DSP-12 gate used for the rhythm class. "model" arrives when replay runs the ONNX rhythm model.
  const rhythmSource = label === null ? 'none' : 'label';
  let output;
  if (outcome.kind === 'inconclusive') {
    output = { outcome, ...provenance, inconclusive: true, rhythmSource };
  } else {
    const evidence = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'docs', 'validation', 'evidence.json'), 'utf8'),
    );
    const reading = core.buildReadingResult(analysis, NO_MODELS, evidence, DEFAULT_PROFILE, []);
    output = {
      ...reading,
      outcome,
      ...provenance,
      inconclusive: reading.headlineKey === 'result.inconclusive',
      rhythmSource,
    };
  }
  fs.writeFileSync(path.join(folder, 'replay-result.json'), `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(path.join(folder, 'replay-intervals.csv'), intervalsCsv(analysis.intervals));
  return { output, context };
}
