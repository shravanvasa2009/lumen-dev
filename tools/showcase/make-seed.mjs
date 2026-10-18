import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../replay/src/core.mjs';

// SHOWCASE ONLY (track/showcase, never merged): made-up morning history for the demo film, at the owner's
// request. Each reading is a synthetic fingertip signal run through the same steps the app runs after a
// capture: LiveSession with SQI-Net, analyzeReading, the shipped rhythm and diabetes models (onnxruntime-node,
// the build the ML-3 parity test checks), and buildReadingResult with the readings before it as history.
// Run: node tools/showcase/make-seed.mjs (Node 22.18 or later).

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODELS = path.join(REPO_ROOT, 'apps/mobile/assets/models');
const SEED_DIR = path.join(REPO_ROOT, 'apps/mobile/src/showcase/seed');
const ort = createRequire(import.meta.url)('onnxruntime-node');

const FPS = 60;
const BATCH_FRAMES = 6; // the module emits a batch every 100 ms
const STATUS_EVERY_FRAMES = 15; // and a status at 4 Hz
const FULL_SCAN_CLEAN_S = 90;
const CLOCK_START_NS = 7_000_000_000_000;
const PROFILE = { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false };
// The seed is generated against this "today"; seedHistory moves every reading to the phone's real dates.
const ANCHOR = new Date(2026, 9, 17);

const PEOPLE = [
  { file: 'shravan.json', seed: 0x5eed16, hr: [72, 68, 77], rmssd: [38, 30, 50], breathing: 14 },
  { file: 'nitin.json', seed: 0x5eed17, hr: [61, 57, 66], rmssd: [62, 50, 75], breathing: 13 },
];

// mulberry32: a small fixed-seed generator, so the same command writes the same files.
function randomSource(seed) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  return { uniform, normal };
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function rmssdOf(intervals) {
  let total = 0;
  for (let i = 1; i < intervals.length; i++) total += (intervals[i] - intervals[i - 1]) ** 2;
  return Math.sqrt(total / (intervals.length - 1));
}

// Beat-to-beat intervals (ms) of a resting sinus rhythm: respiratory sinus arrhythmia at the breathing rate,
// a slow ~0.1 Hz wave, and a little beat-to-beat noise, with the swing scaled so the RMSSD is the target.
function sinusIntervals(random, bpm, rmssdMs, breathingHz, seconds) {
  const meanMs = 60000 / bpm;
  const rsaPhase = 2 * Math.PI * random.uniform();
  const slowPhase = 2 * Math.PI * random.uniform();
  const shape = [];
  for (let tS = 0; tS < seconds + 2;) {
    const swing =
      Math.sin(2 * Math.PI * breathingHz * tS + rsaPhase) +
      0.6 * Math.sin(2 * Math.PI * 0.1 * tS + slowPhase) +
      0.3 * random.normal();
    shape.push(swing);
    tS += meanMs / 1000;
  }
  const scale = rmssdMs / rmssdOf(shape);
  return shape.map((swing) => meanMs + scale * swing);
}

// One fingertip pulse (red falls as blood arrives), seconds after the beat's onset: a fast systolic rise, a
// slower fall, and the reflected (diastolic) wave of a young, elastic artery.
function pulseAt(sinceOnsetS, periodS) {
  const peakS = 0.13;
  const fall = sinceOnsetS < peakS ? 0.045 : 0.12 + 0.08 * (periodS - 0.85);
  const systolic = Math.exp(-0.5 * ((sinceOnsetS - peakS) / fall) ** 2);
  const reflected = 0.3 * Math.exp(-0.5 * ((sinceOnsetS - 0.44) / 0.1) ** 2);
  return systolic + reflected;
}

function syntheticFrames(random, intervalsMs, breathingHz) {
  const onsetsS = [0.3];
  for (const ibi of intervalsMs) onsetsS.push(onsetsS[onsetsS.length - 1] + ibi / 1000);
  const seconds = onsetsS[onsetsS.length - 1] - 1;
  const frames = Math.floor(seconds * FPS);
  const breathPhase = 2 * Math.PI * random.uniform();
  const dc = 0.6 + 0.08 * random.uniform();
  const ac = dc * (0.012 + 0.006 * random.uniform());
  const samples = [];
  const stats = [];
  let beat = 0;
  for (let frame = 0; frame < frames; frame++) {
    const tS = frame / FPS;
    while (onsetsS[beat + 1] <= tS) beat++;
    const breath = Math.sin(2 * Math.PI * breathingHz * tS + breathPhase);
    let pulse = 0;
    for (const k of [beat - 1, beat]) {
      if (k < 0) continue;
      pulse += pulseAt(tS - onsetsS[k], onsetsS[k + 1] - onsetsS[k]);
    }
    // Many pixels are averaged per frame, so sensor noise is a fraction of a percent of the pulse; breathing
    // also moves the baseline by about half a pulse.
    const red = dc + ac * (0.6 * breath - (1 + 0.1 * breath) * pulse + 0.002 * random.normal());
    const tNs = CLOCK_START_NS + Math.round(tS * 1e9);
    samples.push({ tNs, r: red, g: 0.09, b: 0.035 });
    stats.push({ tNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}

function manifestEntry(manifest, family) {
  const entry = manifest.models.find((model) => model.family === family && model.ships === true);
  if (!entry) throw new Error(`the app manifest ships no ${family} model`);
  return entry;
}

async function loadModels() {
  const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
  const session = (entry) =>
    ort.InferenceSession.create(path.join(MODELS, entry.file), { intraOpNumThreads: 1 });
  const [sqi, rhythm, diabetes] = ['sqi', 'rhythm', 'diabetes'].map((family) =>
    manifestEntry(manifest, family),
  );
  return {
    sqi: { entry: sqi, session: await session(sqi) },
    rhythm: { entry: rhythm, session: await session(rhythm) },
    diabetes: { entry: diabetes, session: await session(diabetes) },
  };
}

const tensor = (values, dims) => new ort.Tensor('float32', Float32Array.from(values), dims);

async function scoreOutput(model, feeds) {
  const outputs = await model.session.run(feeds);
  const [name] = Object.keys(model.entry.outputs).filter(
    (output) => model.entry.outputs[output][1] === model.entry.labels.length,
  );
  return Array.from(outputs[name].data, Number);
}

// LiveSession as useLiveCapture feeds it: 100 ms batches, 4 Hz status, SQI-Net on each new 4 s window; the
// capture ends at Full Scan's 90 clean seconds.
async function liveCapture(core, models, frames) {
  const session = core.createLiveSession({
    captureFps: FPS,
    sqiThreshold: models.sqi.entry.threshold.clean,
    perfusionFloorPct: core.DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  let scoredEndS = null;
  for (let start = 0; start < frames.samples.length; start += BATCH_FRAMES) {
    if (start % STATUS_EVERY_FRAMES < BATCH_FRAMES)
      session.pushStatus({ fingerCovered: true, motionRms: 0, thermal: 'nominal', fps: FPS, droppedFrac: 0 });
    session.pushSamples({
      samples: frames.samples.slice(start, start + BATCH_FRAMES),
      stats: frames.stats.slice(start, start + BATCH_FRAMES),
    });
    const window = session.sqiWindow;
    if (window && window.endS !== scoredEndS) {
      scoredEndS = window.endS;
      const [pClean] = await scoreOutput(models.sqi, { window: tensor(window.input, [1, 1, 256]) });
      session.setSqi(window.endS, pClean);
    }
    if (session.cleanSeconds >= FULL_SCAN_CLEAN_S) return session.readingInput();
  }
  throw new Error(`the synthetic capture reached only ${session.cleanSeconds.toFixed(1)} clean seconds`);
}

async function rhythmOutputs(core, models, analysis) {
  const width = models.rhythm.entry.inputs.features[1];
  const windowProbs = [];
  for (const features of core.rhythmModelRows(analysis)) {
    const probs = await scoreOutput(models.rhythm, {
      features: tensor(features.slice(0, width), [1, width]),
    });
    if (!core.isProbabilityRow(probs)) throw new Error(`rhythm model row ${probs} is not a probability row`);
    windowProbs.push(probs);
  }
  return { windowProbs, tauAf: models.rhythm.entry.threshold.af, scorer: 'model' };
}

// runtime.ts scoreDiabetesInput: a feature core left null takes the model's training median.
async function diabetesOutputs(core, models, analysis, rhythm) {
  const input = core.diabetesModelInput(analysis, core.readingRhythm(analysis, rhythm, PROFILE));
  if (input === null) throw new Error('the reading has no averaged beat for diabetes-net');
  const { featureOrder, fillMedians, inputs, threshold } = models.diabetes.entry;
  const filled = (values, name) => values.map((value, i) => value ?? fillMedians[featureOrder[name][i]]);
  const [probability] = await scoreOutput(models.diabetes, {
    beat: tensor(input.beat, inputs.beat),
    shapeFeatures: tensor(filled(input.shapeFeatures, 'shapeFeatures'), inputs.shapeFeatures),
    hrSummary: tensor(filled(input.hrSummary, 'hrSummary'), inputs.hrSummary),
  });
  return { probability, tauDm: threshold.pattern };
}

function localDay(epochMs) {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// readings.ts pastReadings, from the readings generated so far.
function pastReading(reading) {
  const { rmssd, rhythm, diabetes } = reading.results.metrics;
  return {
    atMs: reading.context.recordedAt.ms,
    rhythmPositive: rhythm?.flag != null,
    rmssdMs: rmssd && rmssd.quality !== 'low' ? rmssd.value : null,
    diabetes:
      diabetes && diabetes.quality !== 'low'
        ? {
            day: reading.context.recordedAt.day,
            probability: reading.models.diabetes.probability,
            confidence: diabetes.confidence,
          }
        : null,
  };
}

// About 24 mornings in the last 30 days, not today, with yesterday kept so the streak is live.
function readingDays(random) {
  const days = [];
  for (let daysAgo = 30; daysAgo >= 1; daysAgo--)
    if (daysAgo <= 2 || random.uniform() > 0.2 || days.length + daysAgo < 24) days.push(daysAgo);
  return days;
}

async function personSeed(core, models, evidence, person) {
  const random = randomSource(person.seed);
  const [hrMid, hrLow, hrHigh] = person.hr;
  const [rmssdMid, rmssdLow, rmssdHigh] = person.rmssd;
  const readings = [];
  for (const daysAgo of readingDays(random)) {
    const minuteOfDay = 420 + Math.floor(random.uniform() * 100);
    const bpm = clamp(hrMid + 2.2 * random.normal(), hrLow + 0.5, hrHigh - 0.5);
    // A faster morning has a little less HRV, as it does in a real person.
    const rmssd = clamp(rmssdMid - 1.5 * (bpm - hrMid) + 4.5 * random.normal(), rmssdLow + 4, rmssdHigh - 4);
    const breathingHz = (person.breathing + 0.6 * random.normal()) / 60;
    const intervals = sinusIntervals(random, bpm, rmssd, breathingHz, FULL_SCAN_CLEAN_S + 25);
    const live = await liveCapture(core, models, syntheticFrames(random, intervals, breathingHz));
    const day = new Date(ANCHOR);
    day.setDate(day.getDate() - daysAgo);
    const recordedMs = day.getTime() + minuteOfDay * 60_000;
    const context = {
      captureFps: FPS,
      tier: 'full',
      mode: 'full',
      restTimerDone: true,
      recordedAt: { ms: recordedMs, day: localDay(recordedMs) },
      motionSpans: live.motionSpans,
      coldHandsSpans: live.coldHandsSpans,
      sqi: live.sqi,
      validationRhythmLabel: null,
    };
    const analysis = core.analyzeReading(live.capture, context);
    if (core.readingOutcome(analysis).kind === 'inconclusive')
      throw new Error(`${person.file} day -${daysAgo}: the pipeline refused the synthetic capture`);
    const rhythm = await rhythmOutputs(core, models, analysis);
    const modelOutputs = { rhythm, diabetes: await diabetesOutputs(core, models, analysis, rhythm) };
    const history = readings.map(pastReading).reverse();
    const results = core.buildReadingResult(analysis, modelOutputs, evidence, PROFILE, history);
    readings.push({
      daysAgo,
      minuteOfDay,
      mode: 'full',
      context,
      results,
      models: modelOutputs,
      intervalsMs: analysis.intervals
        .filter(({ accepted }) => accepted)
        .map(({ ibiMs }) => Math.round(ibiMs)),
    });
  }
  return readings;
}

function summary(readings) {
  const values = (pick) => readings.map(pick).sort((x, y) => x - y);
  const hr = values((reading) => reading.results.metrics.hr.value);
  const rmssd = values((reading) => reading.results.metrics.rmssd.value);
  const last = readings[readings.length - 1].results.metrics;
  return {
    readings: readings.length,
    hr: [hr[0], hr[hr.length - 1]].map((bpm) => bpm.toFixed(1)).join('–'),
    rmssd: [rmssd[0], rmssd[rmssd.length - 1]].map((ms) => ms.toFixed(1)).join('–'),
    rmssdBand: last.rmssd.band?.map((ms) => ms.toFixed(1)).join('–'),
    diabetesMean: last.diabetes.probability.toFixed(3),
    quality: [...new Set(readings.map((reading) => reading.results.quality.level))].join(','),
    headlines: [...new Set(readings.map((reading) => reading.results.headlineKey))].join(','),
  };
}

const core = await loadCore();
const models = await loadModels();
const evidence = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'apps/mobile/assets/evidence.json'), 'utf8'),
);
fs.mkdirSync(SEED_DIR, { recursive: true });
for (const person of PEOPLE) {
  const readings = await personSeed(core, models, evidence, person);
  fs.writeFileSync(path.join(SEED_DIR, person.file), `${JSON.stringify(readings)}\n`);
  console.log(person.file, summary(readings));
}
