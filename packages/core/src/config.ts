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
  // Spec initial values (§10 DSP-4): a frame is covered when all four hold. A frame failing only the clip
  // limit is a "clipping" span, any other failure a "coverage" span (ADR 0041).
  dsp4: {
    minRedRatio: 2, // R / (G + B)
    minRedMean: 0.3, // of full scale
    maxSpatialStdR: 0.1,
    maxClipFrac: 0.05,
  },
  dsp5: {
    exposureChangeArtifactS: 1, // spec: an exposure change marks the following 1 s as artifact
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
    // Not given by the spec (ADR 0041): shorter DSP-2 segments are not searched for beats. 2 s is three W2
    // windows and at least one full beat at 40 bpm.
    minSegmentS: 2,
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
    // Running median of amplitude, and the long-pause reference: up to this many usable neighbours on
    // each side, excluding the beat (or interval) itself.
    neighbours: 5,
    // Owner decision H-016 (ADR 0025), proposed for §10 DSP-9. "Early and small" is atypical (kept): an
    // interval < earlyIntervalRatio × the median of up to `neighbours` intervals on each side (intervals
    // between consecutive candidates that are not "not a beat") AND an amplitude < earlySmallAmplitudeRatio
    // × the running median. Same-shape premature beats at 0.5–0.7 × amplitude were otherwise normal.
    earlyIntervalRatio: 0.85,
    earlySmallAmplitudeRatio: 1.0,
  },
  // §6.2 minimum clean data per output; "clean seconds" is reading time not covered by a rejected span.
  dsp10: {
    minCleanS: 30, // §6.2 "Signal strength (perfusion index)"
  },
  dsp11: {
    minCleanS: 15, // §6.2 "Heart rate"
  },
  dsp12: {
    // The caller passes the capture format's frame rate (ADR 0040): a measured median frame interval at
    // 60 fps can read 59.9.
    minFps: 60,
    // Spec values (§10 DSP-12): an NN interval deviating > 20% from the median of up to 5 NN intervals on
    // each side (itself excluded) is dropped before RMSSD, SDNN, and pNN50.
    neighbours: 5,
    maxNeighbourDeviation: 0.2,
    pnnThresholdS: 0.05, // pNN50: successive differences strictly greater than 50 ms, as in dsp15
    rmssdMinCleanS: 60,
    rmssdMinIntervals: 50, // NN intervals left after the 20% filter
    sdnnMinCleanS: 300,
  },
  // Not given by the spec (ADR 0040). scipy.signal.welch parameters: Hann (periodic), detrend 'linear',
  // density scaling, one-sided, mean average. 32 s segments hold ≥ 3 cycles at 6 br/min; the 512-point
  // FFT puts a bin every 0.47 br/min, well inside the 4 br/min agreement rule.
  dsp13: {
    seriesRateHz: 4,
    welchSegmentSamples: 128,
    welchOverlapSamples: 64,
    welchFftSamples: 512,
    bandHz: [0.1, 0.5], // 6–30 breaths/min
    maxSpreadBrpm: 4, // report the mean only when max − min of the three estimates is ≤ this
    minCleanS: 60, // §6.2 "Breathing rate"
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
  // §10.1 decision rules (spec initial values) and §6.2 floors that are not a DSP metric's own.
  rules: {
    slowRestingBpm: 50, // HR below this
    slowRestingAdjustedBpm: 40, // for athletes and people on a beta-blocker
    fastRestingBpm: 100, // HR above this
    restingMinCleanS: 30, // slow/fast resting and fast regular rhythm
    fastRegularBpm: [130, 220],
    fastRegularMaxNormalizedRmssd: 0.03, // strictly below
    rhythmMinCleanS: 60, // irregular rhythm; also needs dsp15.minUsableIntervals
    uncertainBelowTopProb: 0.6, // "Couldn't tell — retake"
    possibleAfPositives: 2, // 2 of 3 readings within 24 h
    possibleAfReadings: 3,
    possibleAfWindowHours: 24,
    diabetesMinReadings: 2, // Full Scans on different days
    diabetesMinCleanS: 90, // §6.2, per reading
    personalBandMinReadings: 7, // §7: the first 7 readings are "learning"
    personalBandIqrs: 1.5, // band = median ± 1.5 IQR
    // DSP-14 preconditions for pulseShape.available. track/dsp-shape (ADR 0030) adds a dsp14 block with
    // minNormalBeats; these two move there when both branches meet.
    pulseShapeMinNormalBeats: 20,
    pulseShapeMinFps: 60,
  },
  // §7 confidence (ADR 0041; initial values, not given by the spec): the lowest of clean coverage, the
  // SQI and tier caps, and for the rhythm card the calibrated top probability.
  confidence: {
    highCoverage: 0.9, // clean seconds / reading seconds
    moderateCoverage: 0.7,
    highTopProb: 0.8, // rhythm top probability; below rules.uncertainBelowTopProb it is low
  },
  // LiveSession (§7 live checks, §9.3, ADR 0042). DSP-4/5 spans use dsp4 and dsp5, as the final analysis
  // does, so the live counter and analyzeReading agree.
  live: {
    // Ring buffers hold the longest reading without wrapping: Deep HRV is 5 min (§7), plus a minute.
    // Capacity = maxReadingS × capture fps × (1 + frameMargin); the margin absorbs timing jitter.
    maxReadingS: 360,
    frameMargin: 0.25,
    waveformS: 6, // §9.3: the live waveform shows the last 6 s
    sqiEveryS: 1, // §11.2: SQI-Net runs every 1 s on the last 4 s (dsp3.modelWindowS)
    // Initial; flagged for Track B, who own motionRms. Appendix A gives no units: this assumes
    // gravity-free acceleration RMS in g (CoreMotion userAcceleration), where hand tremor at rest is
    // about 0.01 g and a deliberate move several times 0.05 g.
    motionRmsThreshold: 0.05,
    // Initial. §7 "pressing too light / ambient leak: green channel rises". A covered frame (DSP-4 needs
    // R ≥ 2 (G + B)) below this ratio gets coach.flat but is not rejected; flicker is not detected.
    leakRedRatio: 2.5,
    coldHandsAfterS: 10, // §7: perfusion index below the device floor after 10 s
    // Live perfusion index = 100 × (max − min of the causal morphology band) / mean R over this window,
    // checked once per sqiEveryS. Initial; the device floor comes from the device database (§7).
    perfusionWindowS: 4,
    defaultPerfusionFloorPct: 0.2, // initial floor for phones without a device-database entry
    // Coaching hysteresis (initial): a condition must hold this long before its key shows, a shown key
    // stays at least coachMinShowS, and it clears after its condition has been gone for coachExitS.
    coachEnterS: 0.5,
    coachMinShowS: 2,
    coachExitS: 1,
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
