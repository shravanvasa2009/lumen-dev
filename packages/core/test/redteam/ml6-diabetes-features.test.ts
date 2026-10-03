import {
  buildTimebase,
  butterBandpass,
  classifyBeats,
  detectBeats,
  DSP_CONFIG,
  ensembleBeat,
  filterZeroPhase,
  fingerSignals,
  hrSummary,
  resampleCubic,
  shapeFeatures,
  type ClassifiedBeat,
  type PulseShape,
} from '../../src';
import { morphologySegment, regularBeats } from '../synthetic';
import {
  cameraCapture,
  pulseOf,
  runoff,
  twoGaussian,
  type CameraSpec,
  type PulseShape as Pulse,
} from '../synthetic-suite/frames';

const RATE_HZ = DSP_CONFIG.dsp2.shapeRateHz;
const BEATS = 30;

const gaussian = (tS: number, sigmaS: number) => Math.exp(-0.5 * (tS / sigmaS) ** 2);

// Left-ventricular ejection time shortens with heart rate (Weissler et al., Circulation 1968;37:149-159:
// LVET ≈ 413 − 1.7 × HR ms in men), so every time constant of a pulse is scaled by LVET(bpm) / LVET(72).
const ejectionScale = (bpm: number) => (0.413 - 0.0017 * bpm) / (0.413 - 0.0017 * 72);

// Finger pulses by Dawber notch class (see synthetic-suite/frames.ts fingerPulseShape for the ranges).
const PULSES: Record<string, (scale: number) => Pulse> = {
  // Class 2 adult: runoff decay 0.2 s, dicrotic hump 0.4× at 0.27 s (σ 60 ms).
  adult: (scale) => runoff(0.2 * scale, 0.4, 0.27 * scale, 0.06 * scale),
  // Class 1 at age ~29: decay 0.12 s, hump 0.6× at 0.346 s (Millasseau 2002), σ 50 ms; the raw diastolic
  // to systolic peak ratio is 0.66, inside the 0.75 physiological cap of synthetic-suite/frames.ts.
  young: (scale) => runoff(0.12 * scale, 0.6, 0.346 * scale, 0.05 * scale),
  // Class 2–3 at age ~60: decay 0.3 s, hump 0.25× at 0.147 s + 50 ms (Millasseau 2002 peak-to-peak time).
  older: (scale) => runoff(0.3 * scale, 0.25, 0.147 * scale + 0.05, 0.06 * scale),
  // Class 1 deep notch: the fixture of test/synthetic.ts, a separate dicrotic wave 0.3× at 0.3 s.
  deepNotch: (scale) => twoGaussian(0.3, 0.3 * scale, 0.08 * scale),
  // Class 4, no notch: runoff decay 0.25 s, no hump.
  noNotch: (scale) => runoff(0.25 * scale, 0, 0.3, 0.05),
  // Stiff arteries: a reflected wave 0.9× at 0.1 s (σ 50 ms) makes a late systolic peak and hides the notch.
  stiffLateSystolic: (scale) => (tS) =>
    runoff(0.3 * scale, 0, 0.3, 0.05)(tS) + 0.9 * gaussian(tS - 0.1 * scale, 0.05 * scale),
};

// The 0.5–8 Hz morphology band at 256 Hz of a regular train, with each onset at the band's minimum in the
// 0.3 s before its peak (DSP-8's onset: the preceding minimum).
function morphologyTrain(pulse: Pulse, bpm: number, transform: (raw: number) => number = (raw) => raw) {
  const periodS = 60 / bpm;
  const peaksS = Array.from({ length: BEATS }, (_, i) => 1 + i * periodS);
  const raw = Array.from({ length: Math.round((BEATS * periodS + 2) * RATE_HZ) }, (_, k) =>
    transform(peaksS.reduce((sum, peakS) => sum + pulse(k / RATE_HZ - peakS), 0)),
  );
  const { morphologyOrder, morphologyBandHz } = DSP_CONFIG.dsp6;
  const band = filterZeroPhase(
    butterBandpass(morphologyOrder, morphologyBandHz[0]!, morphologyBandHz[1]!, RATE_HZ),
    raw,
  );
  const onsets = peaksS.map((peakS) => {
    let onset = Math.round((peakS - 0.3) * RATE_HZ);
    for (let k = onset; k <= Math.round(peakS * RATE_HZ); k++) if (band[k]! < band[onset]!) onset = k;
    return onset;
  });
  return { band, onsets };
}

function shapeOf(band: ArrayLike<number>, onsets: number[], captureFps = 60): PulseShape | null {
  return ensembleBeat(band, onsets, new Array<boolean>(onsets.length).fill(true), captureFps);
}

// The app's path from frames to the DSP-14 beat: timebase, −R, 64 and 256 Hz cubic resampling, morphology
// band, DSP-7/8 beats and DSP-9 classes, then the ensemble over the DSP-8 onsets of the first segment.
function cameraShape(pulse: Pulse, bpm: number, fps: number, spec: Partial<CameraSpec> = {}) {
  const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
  const seconds = Math.max(40, (35 * 60) / bpm + 4);
  const truth = regularBeats(1, seconds - 1, bpm);
  const capture = cameraCapture({ fps, seconds, seed: 3, pulse: pulseOf(truth, pulse), ...spec });
  const timebase = buildTimebase(capture.samples, capture.stats);
  const ppg = fingerSignals(timebase).primary;
  const model = resampleCubic(timebase.tS, ppg, modelRateHz)[0]!;
  const shape = resampleCubic(timebase.tS, ppg, shapeRateHz)[0]!;
  const band = morphologySegment(shape.values, shapeRateHz, shape.firstIndex);
  const beats = classifyBeats(
    detectBeats(morphologySegment(model.values, modelRateHz, model.firstIndex), band),
    band,
    [],
  ).filter((beat) => beat.onsetS !== null);
  return ensembleBeat(
    band.values,
    beats.map((beat) => beat.onsetS! * shapeRateHz - band.firstIndex),
    beats.map((beat) => beat.beatClass === 'normal'),
    fps,
  );
}

// Centre of each pulse's dicrotic component (s after the systolic peak, as built above); null for pulses
// built without one.
const DICROTIC_S: Record<string, (scale: number) => number | null> = {
  adult: (scale) => 0.27 * scale,
  young: (scale) => 0.346 * scale,
  older: (scale) => 0.147 * scale + 0.05,
  deepNotch: (scale) => 0.3 * scale,
  noNotch: () => null,
  stiffLateSystolic: () => null,
};

// Timing finer than a quarter cycle of the morphology band's upper edge (8 Hz: 31 ms) does not survive the
// band, so the notch must lie within this of the constructed one.
const NOTCH_TOLERANCE_S = 1 / (4 * DSP_CONFIG.dsp6.morphologyBandHz[1]!);

// The notch known from how the pulse is built, on the noiseless raw train before any filtering (independent
// of the code under test, which works on the band-passed ensemble): between the systolic peak and the
// dicrotic component's centre, the train's minimum if it dips there (Dawber class 1–2, with the diastolic
// peak after it), else the shoulder where its slope comes closest to 0 (class 3). Null without a dicrotic
// component (class 4). Times are from the raw systolic peak, at 0.1 ms steps.
type ConstructedNotch = { notchS: number; diastolicS: number | null; periodS: number };
function constructedNotch(
  pulse: Pulse,
  bpm: number,
  dicroticS: number | null,
  transform: (raw: number) => number = (raw) => raw,
): ConstructedNotch | null {
  if (dicroticS === null) return null;
  const periodS = 60 / bpm;
  const train = (tS: number) =>
    transform([-2, -1, 0, 1, 2].reduce((sum, n) => sum + pulse(tS - n * periodS), 0));
  const stepS = 1e-4;
  const steps = (fromS: number, toS: number) =>
    Array.from({ length: Math.round((toS - fromS) / stepS) + 1 }, (_, i) => fromS + i * stepS);
  const highest = (times: number[], value: (tS: number) => number) =>
    times.reduce((best, tS) => (value(tS) > value(best) ? tS : best));
  const peakS = highest(steps(-0.1, dicroticS), train);
  const between = steps(peakS, dicroticS);
  const lowestS = highest(between, (tS) => -train(tS));
  if (lowestS > peakS + stepS && lowestS < dicroticS - stepS) {
    const diastolicS = highest(steps(lowestS, lowestS + 0.4 * periodS), train);
    return { notchS: lowestS - peakS, diastolicS: diastolicS - peakS, periodS };
  }
  const slope = (tS: number) => (train(tS + stepS) - train(tS - stepS)) / (2 * stepS);
  const shoulderS = between.find(
    (tS) => tS > peakS + 0.01 && slope(tS) > slope(tS - stepS) && slope(tS) >= slope(tS + stepS),
  );
  return shoulderS === undefined ? null : { notchS: shoulderS - peakS, diastolicS: null, periodS };
}

// Features 4, 5, 6 and 12 (§11.4 order): notch time, notch height, diastolic peak height, area ratio,
// against the constructed notch. Positions are mapped to the ensemble grid from its systolic peak.
function physiology(shape: PulseShape, truth: ConstructedNotch | null, hasDicroticWave: boolean) {
  const features = shapeFeatures(shape);
  const notchTime = features[3]!;
  if (notchTime === null) return { notchReported: false };
  const notchHeight = features[4]!;
  const diastolicPeak = features[5]!;
  const areaRatio = features[11]!;
  const { leadFraction, beatSamples } = DSP_CONFIG.dsp14;
  const notch = (notchTime + leadFraction) * beatSamples;
  const peak = (features[0]! + leadFraction) * beatSamples;
  const samplesOf = (seconds: number) => (seconds / (truth?.periodS ?? 1)) * beatSamples;
  return {
    notchReported: true,
    notchOnConstructedNotch:
      truth === null || Math.abs(notch - peak - samplesOf(truth.notchS)) <= samplesOf(NOTCH_TOLERANCE_S),
    notchBeforeDiastolicPeak: truth?.diastolicS == null || notch < peak + samplesOf(truth.diastolicS),
    notchHeightInUnitRange: notchHeight! >= 0 && notchHeight! <= 1,
    // A constructed diastolic peak must be found; a pulse built without a dicrotic wave must show none.
    diastolicPeakAsConstructed:
      truth?.diastolicS != null ? diastolicPeak! > 0 : hasDicroticWave || diastolicPeak === 0,
    diastolicPeakNotBelowNotch: diastolicPeak === 0 || diastolicPeak! >= notchHeight!,
    positiveAreaRatio: areaRatio !== null && areaRatio > 0,
  };
}

const POSSIBLE = {
  notchReported: true,
  notchOnConstructedNotch: true,
  notchBeforeDiastolicPeak: true,
  notchHeightInUnitRange: true,
  diastolicPeakAsConstructed: true,
  diastolicPeakNotBelowNotch: true,
  positiveAreaRatio: true,
};

function cameraPhysiology(name: string, bpm: number, fps: number) {
  const scale = ejectionScale(bpm);
  const shape = cameraShape(PULSES[name]!(scale), bpm, fps);
  if (shape === null) return null;
  const dicroticS = DICROTIC_S[name]!(scale);
  return physiology(shape, constructedNotch(PULSES[name]!(scale), bpm, dicroticS), dicroticS !== null);
}

describe('red team: ML-6 notch features on realistic finger pulses, against the constructed notch', () => {
  // Through the camera path with 0.02% frame noise and ±1 ms jitter (synthetic-suite cameraCapture, seed 3),
  // 30 regular beats or more. Each case gave a physiologically impossible feature 4, 5, 6 or 12 when the
  // notch was the e-wave; the comment gives what was observed then (visible notch = the band's minimum).
  it.each([
    // e after the diastolic peak: diastolic peak 0, area ratio −0.10 (e 180, visible notch 111).
    ['adult', 72, 60],
    ['adult', 90, 60], // e 203 vs notch 126: diastolic peak 0, area ratio −0.07
    ['adult', 60, 120], // e 160 vs notch 100: diastolic peak 0, area ratio −0.13
    ['older', 45, 60], // e 118 vs notch 76: diastolic peak 0
    ['older', 60, 60], // e 140 vs notch 89: diastolic peak 0, area ratio −0.01
    ['older', 72, 60], // e 156 vs notch 100: diastolic peak 0, area ratio −0.02
    ['older', 90, 60], // e 182 vs notch 115: diastolic peak 0, area ratio −0.04
    ['older', 110, 60], // e 200 vs notch 134: diastolic peak 0, area ratio −0.04
    ['deepNotch', 45, 60], // e 149 vs notch 81: notch height −0.05, area ratio −0.46
    ['deepNotch', 60, 60], // e 181 vs notch 99: notch height −0.08, area ratio −0.30
    ['deepNotch', 72, 60], // e 200 vs notch 112: notch height −0.07, area ratio −0.20
    ['deepNotch', 72, 120], // e 201 vs notch 112: notch height −0.08, area ratio −0.21
    ['noNotch', 90, 60], // no notch; e 153: area ratio −0.02
    ['noNotch', 110, 60], // no notch; e 189: area ratio −0.06
    ['noNotch', 130, 60], // no notch; e 187: area ratio −0.05
    ['stiffLateSystolic', 130, 60], // late systolic peak 118; e 165: area ratio −0.02
  ])(
    '%s pulse at %i bpm, %i fps: notch on the constructed notch, before the diastolic peak, positive area',
    (name, bpm, fps) => {
      expect(cameraPhysiology(name, bpm, fps)).toEqual(POSSIBLE);
    },
  );

  it('sweeps 6 pulses × 45–150 bpm × 60/120/240 fps; only the listed band-limited cases miss', () => {
    // Each miss is a limit of the spec's 0.5–8 Hz morphology band, not of the notch rule (ADR 0059):
    // - young 45–72 bpm: no ensemble beat, DSP-7/8 counts the dicrotic wave as a beat (backlog);
    // - older 45 bpm at 120 fps and 60 bpm at 240 fps: the 0.5 Hz high-pass tilts the class-3 plateau, so
    //   the band's minimum sits 4–8 samples before the raw shoulder at every rate up to 110 bpm; these
    //   two reach the tolerance (6 and 8 samples) by a fraction of a sample;
    // - older ≥ 130 bpm: the band leaves no minimum at the class-3 shoulder, so the upward-bend fallback
    //   lands about 20 samples before it, with diastolic peak 0;
    // - deepNotch 150 bpm: the notch-to-diastolic-peak gap (about 28 ms) is under the band's resolution,
    //   so the notch is lost and the diastolic peak reads 0.
    const misses: string[] = [];
    for (const name of Object.keys(PULSES))
      for (const bpm of [45, 60, 72, 90, 110, 130, 150])
        for (const fps of [60, 120, 240]) {
          const checks = cameraPhysiology(name, bpm, fps);
          if (checks === null) misses.push(`${name} ${bpm} ${fps}: no shape`);
          else
            for (const [check, passed] of Object.entries(checks))
              if (!passed) misses.push(`${name} ${bpm} ${fps}: ${check}`);
        }
    expect(misses).toEqual(KNOWN_MISSES);
  });

  it('features 4, 5, 6 and 12 do not read the e-wave label (deepNotch pulse at 45 bpm, 60 fps)', () => {
    // The notch used to be waves.e; moving e onto the a-wave or removing it must leave them unchanged.
    const shape = cameraShape(PULSES.deepNotch!(ejectionScale(45)), 45, 60)!;
    const notchFeatures = (waves: PulseShape['waves']) =>
      [3, 4, 5, 11].map((i) => shapeFeatures({ ...shape, waves })[i]);
    const labelled = notchFeatures(shape.waves);
    expect(labelled[0]).not.toBeNull();
    expect(notchFeatures({ ...shape.waves, e: shape.waves.a })).toEqual(labelled);
    expect(notchFeatures({ ...shape.waves, e: null })).toEqual(labelled);
  });

  it('older pulse at 72 bpm on the 256 Hz band with onsets at the preceding minimum (mirrored in Python)', () => {
    // e 176 vs visible notch 119 and diastolic peak 130: diastolic peak height 0 (ml/tests/redteam mirror).
    const { band, onsets } = morphologyTrain(PULSES.older!(1), 72);
    const truth = constructedNotch(PULSES.older!(1), 72, DICROTIC_S.older!(1));
    expect(physiology(shapeOf(band, onsets)!, truth, true)).toEqual(POSSIBLE);
  });

  it('adult pulse at 72 bpm with the raw pulse clipped below 0.3 (saturated diastole): diastolic peak above the notch', () => {
    // e 178 vs visible notch 116: diastolic peak 0.03 below the notch height 0.07.
    const clip = (raw: number) => Math.max(raw, 0.3);
    const { band, onsets } = morphologyTrain(PULSES.adult!(1), 72, clip);
    const truth = constructedNotch(PULSES.adult!(1), 72, DICROTIC_S.adult!(1), clip);
    expect(physiology(shapeOf(band, onsets)!, truth, true)).toEqual(POSSIBLE);
  });
});

describe('red team: DSP-14 needs the dicrotic wave of a young pulse not to count as a beat', () => {
  // When this test was written, DSP-7/8 found 74–87 beats for 37–44 true ones at 45–72 bpm (the dicrotic
  // wave detected as a beat, about every other one normal), so no two adjacent beats were both normal and
  // DSP-14 had no ensemble beat at 60 or 120 fps; from 90 bpm on it found every beat.
  // Expected to fail until the Track C backlog item "DSP-7/8 young-pulse double counting" is fixed.
  it.failing.each([
    [45, 60],
    [60, 60],
    [72, 60],
    [72, 120],
  ])('young pulse at %i bpm, %i fps gives an ensemble beat', (bpm, fps) => {
    expect(cameraShape(PULSES.young!(ejectionScale(bpm)), bpm, fps)).not.toBeNull();
  });
});

describe('red team: ML-6 non-finite and degenerate input never reaches diabetes-net', () => {
  const clean = () => morphologyTrain(PULSES.adult!(1), 72);

  it.each([NaN, Infinity, -Infinity])(
    'one %d sample (index 2000) in one beat leaves no non-finite value in the beat input or features',
    (bad) => {
      const { band, onsets } = clean();
      band[2000] = bad;
      const shape = shapeOf(band, onsets);
      if (shape === null) return;
      expect(Array.from(shape.beat).every(Number.isFinite)).toBe(true);
      expect(shapeFeatures(shape).every((value) => value === null || Number.isFinite(value))).toBe(true);
    },
  );

  it('refuses a NaN capture fps (the ≥ 60 fps gate must fail closed)', () => {
    const { band, onsets } = clean();
    expect(shapeOf(band, onsets, NaN)).toBeNull();
  });

  it('a flat, clipped-to-one-value band gives no shape', () => {
    const { onsets } = clean();
    expect(shapeOf(new Float64Array(9000).fill(0.7), onsets)).toBeNull();
  });
});

describe('red team: ML-6 HR/HRV summary gates and degenerate beats', () => {
  const beat = (peakS: number): ClassifiedBeat => ({
    peakS,
    onsetS: peakS - 0.08,
    beatClass: 'normal',
    longPause: false,
  });
  // 81 normal beats alternating 0.9 / 0.8 s: 80 NN intervals, enough for RMSSD and SDNN.
  const alternating = () => {
    let peakS = 1;
    return [[beat(peakS), ...Array.from({ length: 80 }, (_, i) => beat((peakS += i % 2 ? 0.8 : 0.9)))]];
  };

  it('nulls HRV for a NaN capture fps (fails closed like 59.9 fps)', () => {
    expect(hrSummary(alternating(), 'sinus', NaN, 300).slice(1)).toEqual([null, null, null]);
  });

  it('nulls HR for NaN clean seconds (fails closed like 14.999 s)', () => {
    expect(hrSummary(alternating(), 'sinus', 60, NaN)).toEqual([null, null, null, null]);
  });

  it('gives no HR, not Infinity, for two beats with the same peak time (a zero interval)', () => {
    expect(hrSummary([[beat(1), beat(1)]], 'sinus', 60, 300)[0]).toBeNull();
  });
});

// Pinned by the sweep above; each group is explained there.
const KNOWN_MISSES = [
  'young 45 60: no shape',
  'young 45 120: no shape',
  'young 45 240: no shape',
  'young 60 60: no shape',
  'young 60 120: no shape',
  'young 60 240: no shape',
  'young 72 60: no shape',
  'young 72 120: no shape',
  'young 72 240: no shape',
  'older 45 120: notchOnConstructedNotch',
  'older 60 240: notchOnConstructedNotch',
  'older 130 60: notchOnConstructedNotch',
  'older 130 120: notchOnConstructedNotch',
  'older 130 240: notchOnConstructedNotch',
  'older 150 60: notchOnConstructedNotch',
  'older 150 120: notchOnConstructedNotch',
  'older 150 240: notchOnConstructedNotch',
  'deepNotch 150 60: diastolicPeakAsConstructed',
  'deepNotch 150 120: diastolicPeakAsConstructed',
  'deepNotch 150 240: diastolicPeakAsConstructed',
];
