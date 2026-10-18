import { readRecording, writeRecording } from './recording.mjs';

// node tools/showcase/generate-pulse.mjs <recording name> --bpm 74 [--from 9] [--seed 1]
// For a take whose real pulse is too faint for the film (owner, 2026-10-17): keeps every frame before --from
// exactly as recorded (the lens with no finger, the finger landing), then replaces red's pulse with a generated
// one around --bpm, with beat-to-beat variation and breathing. Green, blue and the frame stats stay real, so the
// contact checks still run on the real take. The recording's origin says from which second the pulse is generated.
// Without --from, it starts SETTLE_S after the finger lands: the first moment the lens stays covered for COVERED_S
// (DSP-4's covered lens: red at least 0.3 and at least twice green plus blue), so a 1 s or a 4 s opening both work.

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] !== undefined ? Number(argv[at + 1]) : fallback;
};
const name = argv[0];
const bpm = option('--bpm', NaN);
if (!name || name.startsWith('--') || !Number.isFinite(bpm)) {
  console.error(
    'usage: node tools/showcase/generate-pulse.mjs <recording name> --bpm <beats/min> [--from <s>] [--seed n]',
  );
  process.exit(1);
}

const COVERED_S = 2;
const SETTLE_S = 3;

// Resting adults: breathing about 14 a minute, sinus arrhythmia of a few tens of ms with it, and a pulse that
// dims a camera's red by about 1 % (DSP-4's covered-lens levels, src/demo/syntheticRecording.ts uses the same).
const BREATHS_PER_MIN = 14;
const SINUS_ARRHYTHMIA_S = 0.035;
const BEAT_JITTER_S = 0.02;
const PULSE_DEPTH = 0.01;
const BREATH_DEPTH = 0.0015;
// The real red's slow drift is kept: a moving average over this long carries the drift but not the pulse.
const DRIFT_WINDOW_S = 6;
// The real and generated pulses cross over this long, so the switch is not a step.
const CROSSFADE_S = 2;

let state = option('--seed', 1) >>> 0 || 1;
const random = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 2 ** 32;
};
const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

// One beat's dip in red: the systolic peak, then a smaller reflected wave; 1 at the systolic peak.
const beatShape = (phase) =>
  Math.exp(-(((phase - 0.18) / 0.08) ** 2)) + 0.35 * Math.exp(-(((phase - 0.45) / 0.1) ** 2));

const recording = readRecording(name);
const { tNs, r, g, b } = recording.samples;
const timeS = tNs.map((t) => (t - tNs[0]) / 1e9);
const endS = timeS.at(-1);

function landedS() {
  let coveredSinceS = null;
  for (const [i, t] of timeS.entries()) {
    const covered = r[i] >= 0.3 && r[i] >= 2 * (g[i] + b[i]);
    if (!covered) coveredSinceS = null;
    else if (coveredSinceS === null) coveredSinceS = t;
    else if (t - coveredSinceS >= COVERED_S) return coveredSinceS;
  }
  throw new Error(`${name}: the lens is never covered for ${COVERED_S} s; pass --from`);
}
const givenFromS = option('--from', NaN);
const fromS = Number.isFinite(givenFromS) ? givenFromS : landedS() + SETTLE_S;
console.log(`${name}: frames before ${fromS.toFixed(1)} s stay as recorded`);

const beats = [fromS - 2];
const breathHz = BREATHS_PER_MIN / 60;
while (beats.at(-1) < endS + 2) {
  const at = beats.at(-1);
  const interval =
    60 / bpm + SINUS_ARRHYTHMIA_S * Math.sin(2 * Math.PI * breathHz * at) + BEAT_JITTER_S * gaussian();
  beats.push(at + interval);
}

const half = Math.round((DRIFT_WINDOW_S * (tNs.length - 1)) / endS / 2);
const drift = r.map((_, i) => {
  const window = r.slice(Math.max(0, i - half), i + half + 1);
  return window.reduce((sum, value) => sum + value, 0) / window.length;
});

let beat = 0;
const generated = r.map((real, i) => {
  const t = timeS[i];
  if (t < fromS) return real;
  while (beats[beat + 1] <= t) beat += 1;
  const phase = (t - beats[beat]) / (beats[beat + 1] - beats[beat]);
  const breath = BREATH_DEPTH * Math.sin(2 * Math.PI * breathHz * t);
  const pulse = drift[i] * (1 - PULSE_DEPTH * beatShape(phase) + breath);
  const blend = Math.min(1, (t - fromS) / CROSSFADE_S);
  return real * (1 - blend) + pulse * blend;
});

writeRecording(name, {
  ...recording,
  origin: `${recording.origin}; red's pulse GENERATED from ${fromS} s at about ${bpm} beats/min (generate-pulse.mjs)`,
  samples: { ...recording.samples, r: generated },
});
