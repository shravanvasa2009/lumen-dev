import type { RecordedCapture } from '../../modules/lumen-capture/src';

const FPS = 60;
const FRAME_NS = 1e9 / FPS;
const START_NS = 1e12;
const PULSE_HZ = 1.1; // about 66 beats/min
// Breathing sways the pulse rate a little, as a resting person's does.
const BREATH_HZ = 0.25;
const BREATH_SWAY_RAD = 0.35;

// SYNTHETIC: a generated pulse in red on a fully covered lens, made by this app and not recorded from any
// person (§8.5). It drives Demo mode through the real pipeline via ReplayCapture.
export function syntheticDemoRecording(seconds: number): RecordedCapture {
  const frames = Math.round(seconds * FPS);
  const tNs = Array.from({ length: frames }, (_, frame) => START_NS + frame * FRAME_NS);
  const phase = (frame: number) => {
    const timeS = frame / FPS;
    return 2 * Math.PI * PULSE_HZ * timeS + BREATH_SWAY_RAD * Math.sin(2 * Math.PI * BREATH_HZ * timeS);
  };
  return {
    capabilities: {
      platform: 'android',
      modelId: 'synthetic-demo-phone',
      osVersion: '0',
      rearLenses: [{ id: 'synthetic-wide', kind: 'wide', maxFps: FPS, torchUsable: true }],
      torch: { available: true, levels: true },
      locks: { exposure: true, whiteBalance: true, focus: true },
    },
    samples: {
      tNs,
      r: tNs.map((_, frame) => 0.7 - 0.012 * (Math.sin(phase(frame)) + 0.3 * Math.sin(2 * phase(frame)))),
      g: tNs.map(() => 0.1),
      b: tNs.map(() => 0.1),
    },
    stats: {
      tNs,
      spatialStdR: tNs.map(() => 0.02),
      clipFrac: tNs.map(() => 0),
      exposureNs: tNs.map(() => 8e6),
    },
  };
}
