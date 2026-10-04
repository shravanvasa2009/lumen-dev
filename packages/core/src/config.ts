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
  // Pulse-shape view and diabetes-net's averaged beat (ADR 0030).
  dsp14: {
    minNormalBeats: 20,
    // Each beat (onset to next onset) is resampled to this many samples, so the average is one period
    // long whatever the heart rate: diabetes-net's [1, 1, 256] input.
    beatSamples: 256,
    // The window starts this fraction of a period before the onset, so the a-wave sits clear of the
    // Savitzky–Golay edge fit.
    leadFraction: 0.1,
    // a–e are searched from the window start to onset + this fraction of the period. Ejection lasts about
    // 35–55% of the period from rest to 150 bpm; at 0.6, e sat at 177 of 179 samples at 72 bpm on the
    // synthetic model, so 0.7 leaves margin. Initial value.
    systoleFraction: 0.7,
    // A beat longer than this × the median period of the normal beats most likely hides a missed onset.
    maxPeriodRatio: 1.5,
    savgolWindow: 9,
    savgolOrder: 3,
    minFps: 60,
  },
  // §6.2 minimum clean data per output; "clean seconds" is reading time not covered by a rejected span.
  dsp10: {
    minCleanS: 30, // §6.2 "Signal strength (perfusion index)"
  },
  dsp11: {
    minCleanS: 15, // §6.2 "Heart rate"; the accepted intervals behind the median must span this too (ADR 0080)
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
  // diabetes-net's 12 waveform-shape features from the DSP-14 beat (§11.4, ML-6).
  diabetesFeatures: {
    // Systolic peak widths are measured at these fractions of the peak's height above the beat's minimum
    // (features 2 and 3 in the order §11.4 lists them; ADR 0059). Initial values.
    widthLevels: [0.5, 0.25],
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
    // Rhythm v2 features (ADR 0079), as fractions of the window's median interval. Initial values.
    prematureShortFactor: 0.85, // a premature beat ends an interval shorter than this
    pauseLongFactor: 1.1, // and the compensatory pause that follows is longer than this
    trimmedDiffShare: 0.8, // the trimmed RMSSD keeps this share of the smallest |differences|
    largeChangeFactor: 0.1, // a successive difference above this is a large change
  },
  // Standing heart-rate test (§10 DSP-16, §10.1 "Large rise on standing"; readings of the spec in ADR 0063).
  dsp16: {
    minAgeYears: 13, // §6.6: the profile blocks younger ages
    adolescentMaxAgeYears: 19, // ages minAgeYears..this (inclusive, whole years) use adolescentRiseBpm
    adolescentRiseBpm: 40, // HR − baseline at or above this, ages 13–19
    adultRiseBpm: 30, // HR − baseline at or above this, ages 20 and over
    standingMinutes: [1, 3, 5, 10], // minutes after standing, in protocol order
    consecutiveReadings: 2, // the rise must hold in this many consecutive standing readings
  },
  // §10.1 decision rules (spec initial values) and §6.2 floors that are not a DSP metric's own.
  rules: {
    slowRestingBpm: 50, // HR below this
    slowRestingAdjustedBpm: 40, // for athletes and people on a beta-blocker
    fastRestingBpm: 100, // HR above this
    // §12 Modes "Duration" in clean seconds: §7's countdown counts only these, and a reading short of its
    // mode's target ends inconclusive. Deep HRV's "5 min" is SDNN's §6.2 floor (ADR 0072).
    modeMinCleanS: { quick: 30, full: 90, deep: 300 },
    restingMinCleanS: 30, // slow/fast resting and fast regular rhythm
    fastRegularBpm: [130, 220],
    fastRegularMaxNormalizedRmssd: 0.03, // strictly below
    rhythmMinCleanS: 60, // irregular rhythm; also needs dsp15.minUsableIntervals
    uncertainBelowTopProb: 0.6, // "Couldn't tell — retake"
    // §11.1 Rhythm-Net output check (initial): each window's sinus, af, other must sum to 1 within this.
    // ONNX Runtime returns float32 softmax rows, whose sums are off by a few 1e-7.
    rhythmRowSumTolerance: 1e-5,
    possibleAfPositives: 2, // 2 of 3 readings within 24 h
    possibleAfReadings: 3,
    possibleAfWindowHours: 24,
    diabetesMinReadings: 2, // Full Scans on different days
    diabetesMinCleanS: 90, // §6.2, per reading
    personalBandMinReadings: 7, // §7: the first 7 readings are "learning"
    personalBandIqrs: 1.5, // band = median ± 1.5 IQR
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
    // ADR 0057 flat stretches: exactly equal red this long is one whole beat at 30 bpm, below the 36 bpm
    // edge of the HR band, so it holds no beat. A pulse of at least half an 8-bit step changes red at least
    // twice a period, so its longest equal stretch is under half a period (1 s at 30 bpm).
    minFlatS: 2,
    // ADR 0077 (owner, option C): a model window (dsp3.modelWindowS) holding fewer frames than this many
    // per second is rejected as quality. §5.1's hard-fail floor: a rear camera that can't reach 24 fps.
    minEffectiveFps: 24,
    // ADR 0077 implementation note (red team PR #171 rounds 3 and 4): every subWindowS span that starts on
    // a frame of a model window and ends inside it must also hold minSubWindowFps × subWindowS frames, so
    // a fast burst cannot carry a sparse rest of the window. 16 frames/s is the Nyquist rate for the 8 Hz
    // top of DSP-6's 0.5–8 Hz morphology band (ADR 0077 option D); 24 per 1 s refused random drops at a
    // 26 fps mean. Only tightens the owner's floor.
    minSubWindowFps: 16,
    subWindowS: 1,
    // ADR 0077 implementation note 4 (red team PR #171 rounds 5 and 6): a model window with two frames in a
    // row more than this far apart is rejected, so no stretch is sampled too sparsely for the fastest rate
    // reported. rules.fastRegularBpm tops out at 220 bpm (3.67 Hz); 1 / (2.2 × 3.67 Hz) ≈ 0.124 s, rounded
    // down for timing jitter. Under DSP-2's 0.15 s split; a 30 fps phone dropping 2 frames in a row
    // (100 ms) passes, 3 in a row (133 ms) does not.
    maxFrameGapS: 0.12,
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
  // Lumen Compatibility Rating (§5.1 points, §5.2 tiers; spec initial values, "tune on real phones").
  // Readings of the spec where it is silent are in ADR 0058.
  rating: {
    // §5.1 frame rate: the points of the highest level reached; below the last level is a hard fail.
    fpsLevels: [
      { minFps: 120, points: 30 },
      { minFps: 60, points: 24 },
      { minFps: 30, points: 14 },
      { minFps: 24, points: 6 },
    ],
    // Not given by the spec; the owner chose this tolerance (H-039 A, ADR 0058). A practice capture at
    // a 60 fps format measures 59.6–60, not exactly 60, so the achieved rate reaches a level when it is
    // within this many fps of it. This loosens every "≥ N fps" test in §5.1/§5.2; 0 makes them strict.
    achievedFpsToleranceFps: 0.5,
    // §5.1 coupling: couplingPoints × min(1, PI / fullPi) × min(1, SNR / fullSnr), floored.
    couplingPoints: 35,
    couplingFullPiPct: 1.0,
    couplingFullSnrDb: 12,
    ambientBelowCouplingPoints: 10, // §5.2 and §4.4: ambient-light mode under this many coupling points
    exposureLockPoints: 6,
    whiteBalanceLockPoints: 5,
    focusLockPoints: 4,
    // §5.1 frame timing: SD of frame intervals strictly below each limit (ms) scores its points, else 0.
    timingLevels: [
      { belowSdMs: 1, points: 20 },
      { belowSdMs: 3, points: 12 },
      { belowSdMs: 6, points: 6 },
    ],
    // §5.2 tiers.
    fullMinScore: 80,
    fullMinFps: 60,
    basicMinScore: 50,
    basicMinFps: 30,
    limitedMinScore: 25,
  },
};
