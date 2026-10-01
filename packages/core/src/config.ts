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
    modelWindowS: 4, // model inputs are z-scored per window of this length (SQI-Net: 256 samples at 64 Hz)
  },
  dsp6: {
    // Butterworth prototype order N as in scipy butter(N, ...): N = 4 is 8 poles. §10 DSP-6 says
    // "4th-order" for the HR band; reading that as N = 4 awaits owner confirmation (ADR 0018).
    hrOrder: 4,
    // §10 gives no order for this band; Elgendi et al. 2013 (DSP-7 "as published") use a zero-phase
    // second-order Butterworth 0.5–8 Hz band-pass, as NeuroKit2 does with butter(2, ...) (ADR 0018).
    morphologyOrder: 2,
    hrBandHz: [0.6, 3.5],
    morphologyBandHz: [0.5, 8],
  },
  dsp15: {
    // Windows are counted in intervals, not seconds, so slow heart rates still fill them (§10).
    windowIntervals: 32,
    windowStep: 16, // 50% overlap
    histogramBins: 16, // equal-width bins over the window's min..max, for the Shannon entropy
    pnnThresholdS: 0.05, // pNN50: successive differences strictly greater than 50 ms
    sampleEntropyM: 2,
    sampleEntropyR: 0.2, // × the window's population SD
    minUsableIntervals: 40, // a reading needs this many intervals that do not span an artifact
  },
  // Lab-screen live HR (ADR 0027): the M0 proof's method and limits (§18), not DSP-11. The spectrum runs
  // on the dsp2.modelRateHz grid.
  liveHr: {
    windowS: 10, // analyse only the last 10 s of the input
    // Longest gap-free (DSP-2) stretch needed: ≥ 5 pulse cycles at 40 bpm, and a 0.125 Hz bin spacing.
    minSegmentS: 8,
    detrendHalfWidthS: 1.5, // the proof subtracts a moving average over ±1.5 s
    scanBandHz: [0.6, 3.5],
    scanStepHz: 0.01,
    minBpm: 40,
    maxBpm: 180,
    minSnrDb: 6, // peak power over the median power of the scanned bins
  },
};
