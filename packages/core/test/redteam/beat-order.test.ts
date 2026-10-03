import { analyzeReading, detectBeats, DSP_CONFIG, elgendiPeaks, type ReadingContext } from '../../src';
import { captureAt, morphologySegment, regularOffsets } from '../synthetic';
import { beatTimes } from './attacks';

// Red team (§16) for order D.C_TASK-rhythm-windows-negative-interval: on 3 of 7,137 VitalDB segments
// DSP-7 reported two peaks in reversed time order and DSP-15 then threw, so analyzeReading saved nothing.
// The cause is a 64 Hz candidate whose ±1-sample refinement window lies on a slope of the 256 Hz band:
// the parabola through the window maximum has its vertex far outside the window. Mirrored in
// ml/tests/redteam/test_redteam_beat_order.py. Each test failed when it was written.

const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
const refineHalf = Math.round(DSP_CONFIG.dsp7.refineHalfWindowS * shapeRateHz);

const gaussian = (x: number, centre: number, width: number) => Math.exp(-0.5 * ((x - centre) / width) ** 2);

// 42 bpm: a narrow systolic wave (σ 40 ms, 0.12 s after the foot) and a broad late wave 0.45× as high
// that rises for 80 ms to 0.38 s, then falls in a straight line for 0.45 s. Elgendi opens a block on that
// straight fall, and the refinement window there has almost no curvature. Found by a parameter sweep;
// the late wave is wider than a typical finger pulse's.
const BPM = 42;
function slowPulseVolume(beatsS: number[]): (tS: number) => number {
  const lateWave = (x: number) => (x < -0.08 || x > 0.45 ? 0 : x < 0 ? 1 + x / 0.08 : 1 - x / 0.45);
  return (tS) => {
    let volume = 0;
    for (const beatS of beatsS)
      volume += gaussian(tS - beatS, 0.12, 0.04) + 0.45 * lateWave(tS - beatS - 0.38);
    return volume;
  };
}

const context: ReadingContext = {
  captureFps: 60,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  validationRhythmLabel: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
};

const expectIncreasing = (times: number[]) =>
  times.slice(1).forEach((time, i) => expect(time).toBeGreaterThan(times[i]!));

describe('red team: DSP-7 never reports peaks out of time order', () => {
  it('refines every candidate of the slow pulse within its window, in time order', () => {
    const seconds = 20;
    const volume = slowPulseVolume(beatTimes([60 / BPM], seconds));
    const sampled = (rateHz: number) =>
      morphologySegment(
        Array.from({ length: seconds * rateHz }, (_, k) => volume(k / rateHz)),
        rateHz,
      );
    const model = sampled(modelRateHz);
    const peaksS = detectBeats(model, sampled(shapeRateHz)).map((beat) => beat.peakS);
    const centres = elgendiPeaks(model.values, modelRateHz).map((peak) => (peak / modelRateHz) * shapeRateHz);
    expect(peaksS).toHaveLength(centres.length);
    peaksS.forEach((peakS, i) =>
      expect(Math.abs(peakS * shapeRateHz - centres[i]!)).toBeLessThanOrEqual(refineHalf + 0.5),
    );
    expectIncreasing(peaksS);
  });

  it('analyzes the slow pulse from the camera (60 fps, 60 s) without throwing', () => {
    const seconds = 60;
    const volume = slowPulseVolume(beatTimes([60 / BPM], seconds));
    // Red falls as blood volume rises, a 1% pulse as in attacks.ts.
    const capture = captureAt(regularOffsets(60, seconds), (tS) => ({
      r: 0.6 - 0.006 * volume(tS),
      g: 0.1,
      b: 0.05,
    }));
    const analysis = analyzeReading(capture, context);
    expect(analysis.segments.length).toBeGreaterThan(0);
    for (const segment of analysis.segments) expectIncreasing(segment.map((beat) => beat.peakS));
    for (const interval of analysis.intervals) expect(interval.ibiMs).toBeGreaterThan(0);
  });
});
