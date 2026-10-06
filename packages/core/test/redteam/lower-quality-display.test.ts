import { butterBandpass, CausalFilter, displayPulse, DSP_CONFIG } from '../../src';

// Red team of the displayPulse fix (1.4 × cutoff, no halving): a bump count can hide a lost beat behind an extra
// dicrotic bump, so each beat is matched instead. The live graph's input as display-pulse.test.ts builds it: a
// two-wave pulse through the session's causal band-pass, the last 6 s shown, the live rate from the true beats.

const gaussian = (tS: number, centreS: number, sigmaS: number) =>
  Math.exp(-0.5 * ((tS - centreS) / sigmaS) ** 2);
// Half a 110 bpm premature interval (0.62 × 0.545 s): a bump nearer than this to its beat belongs to it.
const MATCH_S = 0.15;

function shownPulse(intervalsS: number[], heights: number[], fps: number) {
  const peaksS: number[] = [];
  const peakHeights: number[] = [];
  for (let tS = 0.3, k = 0; tS < 21; tS += intervalsS[k % intervalsS.length]!, k++) {
    peaksS.push(tS);
    peakHeights.push(heights[k % heights.length]!);
  }
  const raw = Array.from({ length: 20 * fps }, (_, k) =>
    peaksS.reduce(
      (sum, peakS, i) =>
        sum + peakHeights[i]! * (gaussian(k / fps, peakS, 0.06) + 0.4 * gaussian(k / fps, peakS + 0.3, 0.08)),
      0,
    ),
  );
  const [lowHz, highHz] = DSP_CONFIG.dsp6.morphologyBandHz as [number, number];
  const filtered = new CausalFilter(
    butterBandpass(DSP_CONFIG.dsp6.morphologyOrder, lowHz, highHz, fps),
  ).filter(raw);
  const first = 14 * fps;
  const tS = Array.from({ length: 6 * fps }, (_, k) => (first + k) / fps);
  const liveBpm = (60 * (peaksS.length - 1)) / (peaksS.at(-1)! - peaksS[0]!);
  const shown = displayPulse(tS, Array.from(filtered.slice(first)), liveBpm);
  // Away from the zero-phase edges.
  const inner = (t: number) => t - tS[0]! > 0.8 && tS.at(-1)! - t > 0.8;
  const bumpsS: number[] = [];
  for (let i = 1; i < shown.length - 1; i++)
    if (shown[i]! > shown[i - 1]! && shown[i]! >= shown[i + 1]! && inner(tS[i]!)) bumpsS.push(tS[i]!);
  return { bumpsS, beatsS: peaksS.filter(inner) };
}

describe('red team d42c8b5: every beat of the live graph has its own bump', () => {
  // The causal band-pass delays the systolic peak by up to about 0.1 s at 30 fps; MATCH_S allows that.
  it.each([
    ['regular', 60, [1], [1]],
    ['regular', 110, [1], [1]],
    ['PVC bigeminy 0.62 / 1.38', 75, [0.62, 1.38], [1, 0.6]],
    ['PVC bigeminy 0.62 / 1.38', 110, [0.62, 1.38], [1, 0.6]],
    ['PAC bigeminy 0.7 / 1.05', 75, [0.7, 1.05], [1, 0.7]],
    ['PAC bigeminy 0.7 / 1.05', 110, [0.7, 1.05], [1, 0.7]],
    ['pulsus alternans 1 / 1', 90, [1, 1], [1, 0.6]],
    ['pulsus alternans 1 / 1', 110, [1, 1], [1, 0.6]],
    ['trigeminy 1 / 0.62 / 1.38', 75, [1, 0.62, 1.38], [1, 1, 0.6]],
  ] as [string, number, number[], number[]][])('%s at %i bpm, 30 and 60 fps', (_, bpm, pattern, heights) => {
    for (const fps of [30, 60]) {
      const { bumpsS, beatsS } = shownPulse(
        pattern.map((ratio) => (ratio * 60) / bpm),
        heights,
        fps,
      );
      // Each beat has a bump of its own: the nearest bumps of two beats are never the same one.
      const nearest = beatsS.map((beatS) =>
        bumpsS.reduce(
          (best, bumpS) => (Math.abs(bumpS - beatS) < Math.abs(best - beatS) ? bumpS : best),
          Infinity,
        ),
      );
      nearest.forEach((bumpS, i) => expect(Math.abs(bumpS - beatsS[i]!)).toBeLessThanOrEqual(MATCH_S));
      expect(new Set(nearest).size).toBe(beatsS.length);
      expect(bumpsS.length).toBeLessThanOrEqual(beatsS.length + 1);
    }
  });
});
