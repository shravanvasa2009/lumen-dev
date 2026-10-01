// Mirror of ml/lumen_dsp/dsp_config.json (§10.2); test/config.test.ts fails on any difference.
// Values are the spec's initial values, grouped by DSP ID.
export const DSP_CONFIG = {
  dsp1: {
    droppedFrameGapRatio: 1.5, // a gap > this × the median frame interval is a dropped frame
  },
  dsp2: {
    modelRateHz: 64, // models, quality, rhythm
    shapeRateHz: 256, // onsets, waveform shape
    maxGapS: 0.15, // never interpolate across a longer gap
  },
  dsp3: {
    dcCutoffHz: 0.3, // DC for the perfusion index keeps only what is below this
    // The spec gives no order. 2 (zero-phase, so 4 in effect) leaves 6% of the pulse at 36 bpm (0.6 Hz) in
    // the DC, about 0.06% of DC for a 1% pulse, with less ringing at baseline steps than a higher order.
    dcOrder: 2,
  },
  dsp6: {
    order: 4, // Butterworth prototype order N, as in scipy butter(N, ...): 8 poles per band-pass (ADR 0018)
    hrBandHz: [0.6, 3.5],
    morphologyBandHz: [0.5, 8],
  },
};
