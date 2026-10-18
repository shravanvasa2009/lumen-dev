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
// The lengths of the real takes (tools/showcase-cues.ps1 in the workspace).
const SCAN_S = 120;
const PRACTICE_S = 50;
// Each take opens on the floor, the finger lands on the lens edge at 4 s and lies flat from 5 s.
const LANDS_S = 4;
const FLAT_S = 5;

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

// One continuous take: no finger, the finger landing, then held still.
function take(name, pulseHz, seconds) {
  return generate({
    seconds,
    pulseHz,
    placementAt: (timeS) => (timeS < LANDS_S ? OFF : timeS < FLAT_S ? EDGE : ON),
    motion: [],
    origin: `SYNTHETIC stand-in ${name} (tools/showcase/make-standins.mjs)`,
  });
}

// Shravan's heart rate is the higher of the two (owner, 2026-10-17).
const SHRAVAN_HZ = 1.2; // 72 beats/min
const NITIN_HZ = 1.05; // 63 beats/min
writeRecording('shravan-practice', take('shravan-practice', SHRAVAN_HZ, PRACTICE_S));
writeRecording('nitin-practice', take('nitin-practice', NITIN_HZ, PRACTICE_S));
writeRecording('shravan-scan', take('shravan-scan', SHRAVAN_HZ, SCAN_S));
writeRecording('nitin-scan', take('nitin-scan', NITIN_HZ, SCAN_S));
