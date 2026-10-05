import { act, renderHook } from '@testing-library/react-native';

import { ReplayCapture, type RecordedCapture } from '../../modules/lumen-capture/src';

import { keepCapture } from './keptCapture';
import { livePerfusionPct, signalLevel } from './signalLevel';
import { useLiveCapture } from './useLiveCapture';

jest.setTimeout(60_000);

const PULSE_HZ = 1.2; // 72 beats/min

interface Recipe {
  fps: number;
  seconds: number;
  // Peak amplitude of the pulse in red (0 to 1 scale) at second `tS`.
  amplitudeAt: (tS: number) => number;
  // Mean red at second `tS`; a camera whose auto-exposure is still adapting drifts here.
  levelAt?: (tS: number) => number;
  // Standard deviation of the frame-to-frame noise in red, 0 to 1 scale.
  noise?: number;
  // The lens is uncovered (bright, no red dominance) until this second, then the finger goes on.
  fingerOnAtS?: number;
}

// SYNTHETIC: a covered lens with a pulse of a chosen strength, at the frame rate a phone really runs.
// Deterministic, roughly Gaussian noise, so a run never flakes.
const noiseAt = (i: number) => {
  const uniform = (k: number) => Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;
  return uniform(1) + uniform(2) + uniform(3) + uniform(4) - 2;
};

function recording({
  fps,
  seconds,
  amplitudeAt,
  levelAt = () => 0.7,
  noise = 0,
  fingerOnAtS = 0,
}: Recipe): RecordedCapture {
  const frames = Math.round(seconds * fps);
  const tNs = Array.from({ length: frames }, (_, i) => 1e12 + (i * 1e9) / fps);
  const timeS = (i: number) => i / fps;
  const off = (i: number) => timeS(i) < fingerOnAtS;
  const pulse = (i: number) => {
    const phase = 2 * Math.PI * PULSE_HZ * timeS(i);
    return Math.sin(phase) + 0.3 * Math.sin(2 * phase);
  };
  return {
    capabilities: {
      platform: 'android',
      modelId: 'synthetic-phone',
      osVersion: '0',
      rearLenses: [{ id: 'synthetic-wide', kind: 'wide', maxFps: fps, torchUsable: true }],
      torch: { available: true, levels: true },
      locks: { exposure: true, whiteBalance: true, focus: true },
    },
    samples: {
      tNs,
      r: tNs.map((_, i) =>
        off(i) ? 0.3 : levelAt(timeS(i)) - amplitudeAt(timeS(i)) * pulse(i) + noise * noiseAt(i),
      ),
      g: tNs.map((_, i) => (off(i) ? 0.3 : 0.1)),
      b: tNs.map((_, i) => (off(i) ? 0.3 : 0.1)),
    },
    stats: {
      tNs,
      spatialStdR: tNs.map(() => 0.02),
      clipFrac: tNs.map(() => 0),
      exposureNs: tNs.map(() => 8e6),
    },
  };
}

async function levelsEverySecond(recipe: Recipe, seconds: number): Promise<(number | null)[]> {
  // One module for the whole render: a new one per render would restart the capture on every state update.
  const replay = new ReplayCapture(recording(recipe));
  const live = renderHook(() => useLiveCapture(replay));
  await act(async () => {});
  const levels: (number | null)[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    levels.push(live.result.current.signalLevel);
  }
  return levels;
}

async function levelAfter(recipe: Recipe, seconds: number): Promise<number | null> {
  return (await levelsEverySecond(recipe, seconds)).at(-1) ?? null;
}

beforeEach(() => {
  jest.useFakeTimers();
  keepCapture(null);
});
afterEach(() => jest.useRealTimers());

// On this waveform an amplitude of 0.0008 on 0.7 mean red is a perfusion index of about 0.26 %, and 0.012 about 3.9 %.
const NOISE = 0.0004;
const WEAK = 0.0008;
const STRONG = 0.012;

describe.each([
  [30, 'a 30 fps camera'],
  [60, 'a 60 fps camera'],
])('the practice meter on %i fps (%s)', (fps) => {
  it('sits low for a weak pulse and high for a strong one', async () => {
    const weak = await levelAfter({ fps, seconds: 20, amplitudeAt: () => WEAK, noise: NOISE }, 14);
    const strong = await levelAfter({ fps, seconds: 20, amplitudeAt: () => STRONG, noise: NOISE }, 14);
    expect(weak).not.toBeNull();
    expect(strong).not.toBeNull();
    expect(weak!).toBeLessThan(0.45);
    expect(strong!).toBeGreaterThan(0.9);
  });

  it('follows the signal down when the finger slips and the pulse fades', async () => {
    const fading = await levelAfter({ fps, seconds: 30, amplitudeAt: (tS) => (tS < 12 ? STRONG : WEAK), noise: NOISE }, 26);
    expect(fading!).toBeLessThan(0.45);
  });

  it('does not read Strong in the first seconds after a weak finger is placed from dark', async () => {
    const levels = await levelsEverySecond(
      { fps, seconds: 20, amplitudeAt: () => WEAK, noise: NOISE, fingerOnAtS: 5 },
      16,
    );
    expect(levels.slice(5).filter((level) => level !== null && level >= 2 / 3)).toEqual([]);
    expect(levels.at(-1)).not.toBeNull();
  });

  it('stays low with brightness drifting, as with auto-exposure still adapting (the drift is slow and filtered out)', async () => {
    const drifting = await levelAfter(
      {
        fps,
        seconds: 20,
        amplitudeAt: () => WEAK,
        noise: NOISE,
        levelAt: (tS) => 0.5 + 0.2 * Math.min(1, tS / 20),
      },
      14,
    );
    expect(drifting!).toBeLessThan(0.45);
  });
});

describe('signalLevel', () => {
  const frames = (seconds: number) =>
    Array.from({ length: seconds * 10 }, (_, i) => ({ tNs: i * 1e8, r: 0.7, g: 0.1, b: 0.1 }));

  it('is null before the session has a perfusion index', () => {
    expect(signalLevel(null, frames(3), 3e9)).toBeNull();
  });

  it('uses the perfusion index alone until there are enough frames for the pulse SNR', () => {
    expect(signalLevel(0.5, frames(3), 3e9)).toBeCloseTo(0.5, 6);
    expect(signalLevel(4, frames(3), 3e9)).toBe(1);
  });

  it('reads a flat signal with enough frames as no pulse', () => {
    expect(signalLevel(0.9, frames(12), 12e9)).toBe(0);
  });
});

describe('livePerfusionPct', () => {
  it('is null without a pulse window or a red level', () => {
    expect(livePerfusionPct({ tS: [], ppg: [] }, [])).toBeNull();
    expect(livePerfusionPct({ tS: [1, 2], ppg: [0, 0.01] }, [{ tNs: 2e9, r: 0 }])).toBeNull();
  });

  it('is 100 x peak-to-peak over mean red within the last 4 s only', () => {
    const waveform = { tS: [0, 5, 6, 7, 8], ppg: [-1, -0.005, 0.005, 0, 0] };
    const reds = [
      { tNs: 0, r: 9 },
      { tNs: 5e9, r: 0.5 },
      { tNs: 8e9, r: 0.5 },
    ];
    expect(livePerfusionPct(waveform, reds)).toBeCloseTo(2, 6);
  });
});
