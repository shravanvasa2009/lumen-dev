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
  // Elgendi et al. 2013 (PLoS ONE, doi:10.1371/journal.pone.0076585), run on the 64 Hz morphology band.
  dsp7: {
    peakWindowS: 0.111, // W1 for MA_peak; also the minimum block width (THR2)
    beatWindowS: 0.667, // W2 for MA_beat
    beta: 0.02, // THR1 = MA_beat + beta · mean(squared signal)
    // The 64 Hz peak is refined on the 256 Hz morphology band within ± one 64 Hz sample.
    refineHalfWindowS: 0.015625,
  },
  dsp8: {
    // The beat foot is searched back from the peak over this span, never past the previous peak.
    minimumSearchS: 0.4,
  },
  dsp9: {
    // Not a beat when its maximum upslope < this × the median upslope. Owner decision H-016 (ADR 0025):
    // 0.15, not the spec's 0.3, which removed small premature beats riding on the previous beat's
    // falling side. A foot-level dicrotic rule was tried and withdrawn because it removed real beats
    // on BUT PPG (ADR 0025).
    notABeatUpslopeRatio: 0.15,
    // Spec values (§10 DSP-9).
    artifactIntervalS: [0.25, 2.5], // an interval outside this range makes its ending beat an artifact
    templateCorrelationMin: 0.85, // atypical below this Pearson correlation with the template
    amplitudeRatioRange: [0.5, 2.0], // atypical outside this × the running median amplitude
    templateBeats: 10, // the template is the mean of the last this-many normal beats
    longPauseRatio: 1.6, // long pause when an interval ≥ this × the median of its neighbours
    // Not given by the spec (initial, ADR 0025). The template window spans the foot (onsets fall 50–250
    // ms before the peak) and the top of the systolic wave; at 0.3 s it is shorter than the interval at
    // 150 bpm, so the next upstroke rarely enters it.
    templateBeforePeakS: 0.2,
    templateAfterPeakS: 0.1,
    // Running median of amplitude, the early-beat interval reference, and the long-pause reference: the
    // nearest `neighbours` items at odd and at even offsets from the beat (itself excluded), so alternating
    // rhythms (bigeminy) stay balanced, at segment edges too (red-team v2, ADR 0025).
    neighbours: 4,
    // Fewer than this many references per parity: no reference, so that beat gets no amplitude, early, or
    // long-pause judgement (ADR 0025).
    minNeighboursPerParity: 2,
    // Owner decision H-016 (ADR 0025), proposed for §10 DSP-9. "Early and small" is atypical (kept): an
    // interval < earlyIntervalRatio × the median of up to `neighbours` intervals on each side (intervals
    // between consecutive candidates that are not "not a beat") AND an amplitude < earlySmallAmplitudeRatio
    // × the running median. Same-shape premature beats at 0.5–0.7 × amplitude were otherwise normal.
    earlyIntervalRatio: 0.85,
    earlySmallAmplitudeRatio: 1.0,
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
    windowS: 10,
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
