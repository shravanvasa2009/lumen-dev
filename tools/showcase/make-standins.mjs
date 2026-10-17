import { writeRecording } from './recording.mjs';

// node tools/showcase/make-standins.mjs
// SYNTHETIC rehearsal stand-ins for the showcase film: generated pulses, not recorded from anyone. They are
// replaced by real Lab captures (import-capture.mjs) before filming. Same idea as src/demo/syntheticRecording.ts,
// at a Galaxy A17's 30 fps, with the scripted bad stretches added.

const FPS = 30;
const FRAME_NS = 1e9 / FPS;
const START_NS = 1e12;
const BREATH_HZ = 0.25;
const BREATH_SWAY_RAD = 0.35;
const SCAN_S = 110;
const ATTEMPT1_S = 30;

// A covered lens under the torch: red far above green and blue (DSP-4 needs R ≥ 2 (G + B) and R ≥ 0.3).
const ON = { r: 0.7, g: 0.1, b: 0.1, spatialStdR: 0.02 };
// Fingertip resting on the edge of the lens: still covered, but red under live.leakRedRatio (2.5) × (G + B).
const EDGE = { r: 0.48, g: 0.11, b: 0.105, spatialStdR: 0.05 };
// Fingertip lifted: room light, red no longer dominant, and a patchy frame.
const OFF = { r: 0.24, g: 0.2, b: 0.18, spatialStdR: 0.18 };

const CAPABILITIES = {
  platform: 'android',
  modelId: 'synthetic-standin',
  osVersion: '0',
  rearLenses: [{ id: 'synthetic-wide', kind: 'wide', maxFps: FPS, torchUsable: true }],
  torch: { available: true, levels: false },
  locks: { exposure: true, whiteBalance: true, focus: true },
};

const inside = (spans, timeS) => spans.some(({ fromS, toS }) => timeS >= fromS && timeS < toS);

// placementAt(timeS) → ON, EDGE or OFF. During `motion` the red level swings well beyond the pulse, as a
// fingertip sliding on the lens makes it; the swing stays 0.3 s inside each span so it is all rejected.
function generate({ seconds, pulseHz, placementAt, motion, origin }) {
  const frames = Math.round(seconds * FPS);
  const tNs = Array.from({ length: frames }, (_, frame) => START_NS + frame * FRAME_NS);
  const columns = { r: [], g: [], b: [], spatialStdR: [] };
  tNs.forEach((_, frame) => {
    const timeS = frame / FPS;
    const phase = 2 * Math.PI * pulseHz * timeS + BREATH_SWAY_RAD * Math.sin(2 * Math.PI * BREATH_HZ * timeS);
    const level = placementAt(timeS);
    const pulse = level === OFF ? 0 : -0.012 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
    const shaking = motion.some(({ fromS, toS }) => timeS >= fromS + 0.3 && timeS < toS - 0.3);
    const swing = shaking
      ? 0.09 * Math.sin(2 * Math.PI * 1.7 * timeS) + 0.04 * Math.sin(2 * Math.PI * 4.3 * timeS)
      : 0;
    columns.r.push(level.r + pulse + swing);
    columns.g.push(level.g);
    columns.b.push(level.b);
    columns.spatialStdR.push(level.spatialStdR + (shaking ? 0.03 : 0));
  });
  return {
    origin,
    capabilities: CAPABILITIES,
    motion,
    samples: { tNs, r: columns.r, g: columns.g, b: columns.b },
    stats: {
      tNs,
      spatialStdR: columns.spatialStdR,
      clipFrac: tNs.map(() => 0),
      exposureNs: tNs.map(() => 8e6),
    },
  };
}

// Attempt 1: the finger rests on the lens edge, lifts off, comes back shaking, lifts again; nothing settles.
function attemptOne(name, pulseHz) {
  const edge = [
    { fromS: 0, toS: 2.5 },
    { fromS: 13, toS: 15.5 },
  ];
  const on = [
    { fromS: 6, toS: 8.5 },
    { fromS: 19, toS: 21.5 },
  ];
  return generate({
    seconds: ATTEMPT1_S,
    pulseHz,
    placementAt: (timeS) => (inside(edge, timeS) ? EDGE : inside(on, timeS) ? ON : OFF),
    motion: on,
    origin: `SYNTHETIC stand-in ${name} (tools/showcase/make-standins.mjs)`,
  });
}

function scan(name, pulseHz, motion) {
  return generate({
    seconds: SCAN_S,
    pulseHz,
    placementAt: () => ON,
    motion,
    origin: `SYNTHETIC stand-in ${name} (tools/showcase/make-standins.mjs)`,
  });
}

// Timing plan: the A17 (Shravan) moves three times for 4 s, the iPhone (Nitin) once for 12 s over the A17's
// second stretch, so both lose 12 s and reach 90 clean seconds together.
const SHRAVAN_HZ = 1.2; // 72 beats/min
const NITIN_HZ = 1.05; // 63 beats/min
writeRecording('shravan-attempt1', attemptOne('shravan-attempt1', SHRAVAN_HZ));
writeRecording('nitin-attempt1', attemptOne('nitin-attempt1', NITIN_HZ));
writeRecording(
  'shravan-scan',
  scan('shravan-scan', SHRAVAN_HZ, [
    { fromS: 20, toS: 24 },
    { fromS: 45, toS: 49 },
    { fromS: 70, toS: 74 },
  ]),
);
writeRecording('nitin-scan', scan('nitin-scan', NITIN_HZ, [{ fromS: 41, toS: 53 }]));
