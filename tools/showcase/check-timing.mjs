import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { loadCore } from '../replay/src/core.mjs';
import { medianIntervalNs, readRecording, REPO_ROOT } from './recording.mjs';

// node tools/showcase/check-timing.mjs <name or file> [--mode full|quick] [--tier full|basic|limited]
// Plays a showcase recording through @lumen/core's LiveSession on the app's schedule (ReplayCapture: a sample
// batch every 100 ms, a status every 250 ms; useLiveCapture: SQI-Net on each new window), then analyses the
// reading as Processing does, with the shipped SQI and rhythm models (onnxruntime-node). Prints when the
// clean count reaches 30 and 90 s, every rejected span, the coaching line the screen shows, and the result.
// Not simulated: the diabetes model, past readings (history rules), and JS timer jitter (±0.1 s).

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const target = process.argv[2];
if (!target || target.startsWith('--')) {
  console.error(
    'usage: node tools/showcase/check-timing.mjs <recording name or file> [--mode full|quick] [--tier full]',
  );
  process.exit(1);
}
const mode = argument('--mode', 'full');
const tier = argument('--tier', 'full');
const neededS = mode === 'quick' ? 30 : 90;

const BATCH_MS = 100;
const STATUS_MS = 250;
const STEP_MS = 50;
// Mirrors scanSource.ts SCRIPTED_MOTION_RMS.
const SCRIPTED_MOTION_RMS = 0.3;
// Mirrors useLiveCapture ADVANCE_HOLD_NS and captureVerdict's span-to-coaching table.
const ADVANCE_HOLD_NS = 2e9;
const NOW_TOLERANCE_S = 2;
const COACHING_FOR = {
  coverage: 'coach.cover',
  clipping: 'coach.lighter',
  pressure: 'coach.lighter',
  motion: 'coach.still',
  coldHands: 'coach.warm',
  exposure: 'coach.brightness',
};
// Mirrors filmVideo.tsx SLIP and scanSource.ts SLIPPED_GREEN_BLUE_SHARE: the scan take's scripted slipped finger.
const SLIP = { fromS: 42, toS: 46 };
const SLIPPED_GREEN_BLUE_SHARE = 0.4;
const PROFILE = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };

const core = await loadCore();
const ort = createRequire(import.meta.url)('onnxruntime-node');
const modelsDir = path.join(REPO_ROOT, 'apps', 'mobile', 'assets', 'models');
const manifest = JSON.parse(fs.readFileSync(path.join(modelsDir, 'manifest.json'), 'utf8'));
const shipped = (family) => manifest.models.find((entry) => entry.family === family && entry.ships);
const sqiEntry = shipped('sqi');
const rhythmEntry = shipped('rhythm');
const ruleEntry = manifest.models.find((entry) => entry.family === 'rhythm' && !entry.ships && entry.rule);
const sqiModel = await ort.InferenceSession.create(path.join(modelsDir, sqiEntry.file));
const rhythmModel = await ort.InferenceSession.create(path.join(modelsDir, rhythmEntry.file));

async function score(model, entry, values) {
  const [input, dims] = Object.entries(entry.inputs)[0];
  const outputs = await model.run({ [input]: new ort.Tensor('float32', values, dims) });
  return Array.from(outputs[Object.keys(entry.outputs)[0]].data, Number);
}

const recording = readRecording(target);
const { samples, stats } = recording;
const motion = recording.motion ?? [];
const rows = samples.tNs.map((tNs, i) => ({
  sample: { tNs, r: samples.r[i], g: samples.g[i], b: samples.b[i] },
  stat: {
    tNs: stats.tNs[i],
    spatialStdR: stats.spatialStdR[i],
    clipFrac: stats.clipFrac[i],
    exposureNs: stats.exposureNs[i],
  },
}));
const firstNs = samples.tNs[0];
if (/scan/.test(path.basename(target)))
  for (const row of rows) {
    const atS = (row.sample.tNs - firstNs) / 1e9;
    if (atS >= SLIP.fromS && atS < SLIP.toS)
      row.sample.g = row.sample.b = SLIPPED_GREEN_BLUE_SHARE * row.sample.r;
  }
const captureFps = 1e9 / medianIntervalNs(samples.tNs);
const sqiThreshold = sqiEntry.threshold[sqiEntry.labels[0]];
const session = core.createLiveSession({
  captureFps,
  sqiThreshold,
  perfusionFloorPct: core.DSP_CONFIG.live.defaultPerfusionFloorPct,
});

const seconds = (ns) => (ns - firstNs) / 1e9;
let cursor = 0;
let scoredEndS = null;
let lastClean = 0;
let lastRiseNs = null;
let shownCoaching = null;
const coachingLog = [];
const reached = {};

function screenCoaching(newestNs) {
  const advancing = lastRiseNs !== null && newestNs - lastRiseNs <= ADVANCE_HOLD_NS;
  if (advancing) return session.coachingKey;
  const nowS = seconds(newestNs);
  const open = session.rejectedSpans
    .filter((span) => span.endS >= nowS - NOW_TOLERANCE_S)
    .reduce((latest, span) => (latest && latest.endS >= span.endS ? latest : span), null);
  return session.coachingKey ?? (open ? (COACHING_FOR[open.reason] ?? null) : null) ?? 'coach.notClean';
}

async function emitBatch(edgeNs) {
  const batch = [];
  while (cursor < rows.length && rows[cursor].sample.tNs < edgeNs) batch.push(rows[cursor++]);
  if (batch.length === 0) return;
  session.pushSamples({ samples: batch.map((row) => row.sample), stats: batch.map((row) => row.stat) });
  const window = session.sqiWindow;
  if (window && window.endS !== scoredEndS) {
    scoredEndS = window.endS;
    const [pClean] = await score(sqiModel, sqiEntry, window.input);
    session.setSqi(window.endS, pClean);
  }
  const newestNs = batch.at(-1).sample.tNs;
  if (session.cleanSeconds > lastClean) lastRiseNs = newestNs;
  lastClean = session.cleanSeconds;
  const coaching = screenCoaching(newestNs);
  if (coaching !== shownCoaching) {
    coachingLog.push({ atS: seconds(newestNs), coaching, clean: session.cleanSeconds });
    shownCoaching = coaching;
  }
  for (const mark of [30, neededS])
    if (reached[mark] === undefined && session.cleanSeconds >= mark) reached[mark] = seconds(newestNs);
}

function emitStatus() {
  if (cursor < 2) return;
  const newest = rows[cursor - 1];
  const nowS = seconds(newest.sample.tNs);
  const moving = motion.some(({ fromS, toS }) => nowS >= fromS && nowS < toS);
  session.pushStatus({
    fingerCovered: core.frameProblem(newest.sample, newest.stat) !== 'coverage',
    motionRms: moving ? SCRIPTED_MOTION_RMS : 0,
    thermal: 'nominal',
    fps: captureFps,
    droppedFrac: 0,
  });
}

for (let tMs = STEP_MS; cursor < rows.length && reached[neededS] === undefined; tMs += STEP_MS) {
  if (tMs % BATCH_MS === 0) await emitBatch(firstNs + tMs * 1e6);
  if (tMs % STATUS_MS === 0) emitStatus();
}

const fmt = (value) => (value === undefined ? 'never' : `${value.toFixed(1)} s`);
console.log(`${recording.origin ?? target}`);
console.log(
  `  ${rows.length} frames at ${captureFps.toFixed(2)} fps, ${seconds(samples.tNs.at(-1)).toFixed(1)} s long`,
);
console.log(`  scripted motion: ${motion.map(({ fromS, toS }) => `${fromS}-${toS}`).join(', ') || 'none'}`);
console.log(
  `  clean 30 s at capture time ${fmt(reached[30])}; clean ${neededS} s (Processing) at ${fmt(reached[neededS])}`,
);
console.log('  rejected spans (capture seconds):');
for (const span of session.rejectedSpans)
  console.log(
    `    ${span.startS.toFixed(2)}-${span.endS.toFixed(2)} (${(span.endS - span.startS).toFixed(2)} s) ${span.reason} → ${COACHING_FOR[span.reason] ?? 'coach.notClean'}`,
  );
console.log('  coaching line on screen:');
for (const { atS, coaching, clean } of coachingLog)
  console.log(
    `    from ${atS.toFixed(1)} s: ${coaching ?? '(none, counting)'} at ${Math.floor(clean)} clean s`,
  );

if (reached[neededS] === undefined) {
  console.log(`  the recording ran out before ${neededS} clean seconds; no reading`);
  process.exit(0);
}

const input = session.readingInput();
const recordedMs = Date.now();
const context = {
  captureFps,
  tier,
  mode,
  restTimerDone: false,
  recordedAt: { ms: recordedMs, day: new Date(recordedMs).toISOString().slice(0, 10) },
  motionSpans: input.motionSpans,
  coldHandsSpans: input.coldHandsSpans,
  sqi: input.sqi,
  validationRhythmLabel: null,
};
const analysis = core.analyzeReading(input.capture, context);
const outcome = core.readingOutcome(analysis);
console.log(`  outcome: ${outcome.kind}, urgent ${JSON.stringify(outcome.urgent)}`);
if (outcome.kind === 'inconclusive') {
  console.log(`  ${JSON.stringify(outcome)}`);
  process.exit(0);
}

// analyzeKeptCapture's rhythmOutputs: the model on every row, else the logistic rule on every row.
async function rhythmOutputs() {
  const featureRows = core.rhythmModelRows(analysis);
  if (featureRows.length === 0) return null;
  const width = rhythmEntry.inputs.features[1];
  const windowProbs = [];
  for (const features of featureRows) {
    const probs = await score(rhythmModel, rhythmEntry, Float32Array.from(features.slice(0, width)));
    if (!core.isProbabilityRow(probs))
      return { ...core.logisticRhythmOutputs(ruleEntry, featureRows), scorer: 'rule' };
    windowProbs.push(probs);
  }
  return { windowProbs, tauAf: rhythmEntry.threshold.af, scorer: 'model' };
}

const models = { rhythm: await rhythmOutputs(), diabetes: null };
const evidence = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'apps', 'mobile', 'assets', 'evidence.json'), 'utf8'),
);
const reading = core.buildReadingResult(analysis, models, evidence, PROFILE, []);
const { hr, rhythm, rmssd, resp } = reading.metrics;
console.log(
  `  headline ${reading.headlineKey}; quality ${reading.quality.level} ${reading.quality.reasons.map((reason) => reason.kind).join(',')}`,
);
console.log(
  `  retakePrompt ${reading.retakePrompt}; clean ${reading.cleanSeconds.toFixed(1)} s, ${reading.beats} beats, ${reading.rejectedBeats} rejected`,
);
console.log(`  HR ${hr ? `${hr.value.toFixed(1)} bpm flag ${hr.flag} ${hr.confidence}` : 'none'}`);
console.log(
  `  rhythm ${rhythm ? `${rhythm.class} pAF ${rhythm.pAF?.toFixed(3)} flag ${rhythm.flag} ${rhythm.confidence} (${models.rhythm?.scorer})` : 'none'}`,
);
console.log(
  `  RMSSD ${rmssd ? `${rmssd.value.toFixed(1)} ms` : 'none'}; breathing ${resp ? `${resp.value.toFixed(1)} br/min` : 'none'}`,
);
