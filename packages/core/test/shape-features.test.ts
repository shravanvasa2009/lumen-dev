import fs from 'node:fs';
import path from 'node:path';
import {
  butterBandpass,
  DSP_CONFIG,
  ensembleBeat,
  filterZeroPhase,
  SHAPE_FEATURE_NAMES,
  shapeFeatures,
  type PulseShape,
  type WaveLabels,
} from '../src';

const { beatSamples, leadFraction } = DSP_CONFIG.dsp14;
const RATE_HZ = DSP_CONFIG.dsp2.shapeRateHz;

// Piecewise-linear beat through these (sample, height) corners, flat outside them. The onset sits at
// sample 25.6 (lead fraction 0.1 × 256) on the flat foot, so the onset level and the beat's minimum are
// exactly 0 and every crossing and trapezoid below is exact. Same corners as
// ml/lumen_dsp/tests/test_shape_features.py.
const CORNERS: [number, number][] = [
  [26, 0],
  [77, 1], // systolic peak
  [130, 0.4], // dicrotic notch
  [150, 0.5], // diastolic peak
  [230, 0],
];

function piecewiseBeat(corners = CORNERS): Float64Array {
  const [firstCorner, firstValue] = corners[0]!;
  const [lastCorner, lastValue] = corners[corners.length - 1]!;
  return Float64Array.from({ length: beatSamples }, (_, k) => {
    if (k <= firstCorner) return firstValue;
    if (k >= lastCorner) return lastValue;
    const segment = corners.findIndex(([corner]) => corner >= k);
    const [k0, v0] = corners[segment - 1]!;
    const [k1, v1] = corners[segment]!;
    return v0 + ((v1 - v0) * (k - k0)) / (k1 - k0);
  });
}

const WAVES: WaveLabels = { a: 30, b: 40, c: 60, d: 90, e: 130 };
const WAVE_HEIGHTS = { a: 2, b: -1, c: 0.5, d: -0.4, e: 0.3 };

function analyticShape(waves: WaveLabels = WAVES, beat = piecewiseBeat()): PulseShape {
  const secondDerivative = new Float64Array(beatSamples);
  for (const wave of ['a', 'b', 'c', 'd', 'e'] as const) secondDerivative[WAVES[wave]!] = WAVE_HEIGHTS[wave];
  return { beat, smoothed: beat, secondDerivative, waves, beatsUsed: 20 };
}

describe('ML-6 diabetes-net shape features on an analytic beat (hand-computed answers)', () => {
  const features = shapeFeatures(analyticShape());

  it('returns 12 features', () => {
    expect(features).toHaveLength(12);
  });

  it('measures times as fractions of the period from the onset at sample 25.6', () => {
    expect(leadFraction * beatSamples).toBeCloseTo(25.6, 12);
    expect(features[0]).toBeCloseTo((77 - 25.6) / 256, 12); // rise time
    expect(features[3]).toBeCloseTo((130 - 25.6) / 256, 12); // notch: first minimum after the peak
  });

  it('measures peak widths at 50% and 25% of the peak height by linear interpolation', () => {
    // 50%: up at 26 + 51/2, down on the first fall (1 → 0.4 over 53 samples) at 77 + 53 × 0.5/0.6.
    expect(features[1]).toBeCloseTo((77 + (53 * 0.5) / 0.6 - 51.5) / 256, 12);
    // 25%: up at 26 + 51/4; the first fall stays above 0.25, so down on the last fall at 150 + 80/2.
    expect(features[2]).toBeCloseTo((190 - 38.75) / 256, 12);
  });

  it('gives notch and diastolic peak heights relative to the systolic peak above the beat minimum', () => {
    expect(features[4]).toBeCloseTo(0.4, 12);
    expect(features[5]).toBeCloseTo(0.5, 12);
  });

  it('gives the second-derivative ratios and the aging index', () => {
    expect(features.slice(6, 10)).toEqual([-0.5, 0.25, -0.2, 0.15]);
    expect(features[10]).toBeCloseTo((-1 - 0.5 + 0.4 - 0.3) / 2, 14);
  });

  it('gives the diastolic / systolic area ratio by the trapezoid rule', () => {
    // Systolic: 51 × 1/2 + 53 × 0.7 = 62.6; diastolic: 20 × 0.45 + 80 × 0.25 = 29 (sample units).
    expect(features[11]).toBeCloseTo(29 / 62.6, 12);
  });

  it('is unchanged in all 12 features by a gain and an offset on a beat whose tail is below the onset', () => {
    // The beat minimum (−0.1) differs from the onset level (0), and the second derivative scales with the
    // gain, so the reference level and the a-wave ratios are both exercised.
    const shape = analyticShape(WAVES, piecewiseBeat([...CORNERS.slice(0, 4), [230, -0.1]]));
    const before = shapeFeatures(shape);
    const scaled = shape.beat.map((value) => 3 + 0.5 * value);
    const after = shapeFeatures({
      ...shape,
      beat: scaled,
      smoothed: scaled,
      secondDerivative: shape.secondDerivative.map((value) => 0.5 * value),
    });
    expect(before.every((value) => value !== null)).toBe(true);
    after.forEach((value, i) => expect(value).toBeCloseTo(before[i]!, 12));
  });

  it('is unchanged by a gain and an offset on the beat', () => {
    const shape = analyticShape();
    const scaled = shape.beat.map((value) => 3 + 0.5 * value);
    const moved = shapeFeatures({ ...shape, beat: scaled, smoothed: scaled });
    moved.slice(0, 6).forEach((value, i) => expect(value).toBeCloseTo(features[i]!, 12));
    expect(moved[11]).toBeCloseTo(features[11]!, 12);
  });

  it('includes the lead-in (the previous period end) in the diastolic area', () => {
    // Window sample 255 is followed in phase by lead-in sample 0. A 0.2 plateau over lead-in samples 0–20
    // adds 0.1 (255 → 0) + 20 × 0.2 + 0.1 (20 → 21) = 4.2 to the diastolic area; the onset level stays 0.
    const shape = analyticShape();
    const leadIn = shape.beat.map((value, k) => (k <= 20 ? 0.2 : value));
    const withLeadIn = shapeFeatures({ ...shape, beat: leadIn, smoothed: leadIn });
    expect(withLeadIn[11]).toBeCloseTo(33.2 / 62.6, 12);
    expect(withLeadIn[5]).toBeCloseTo(0.5, 12);
  });

  it('measures every amplitude above the beat minimum when the tail falls below the onset level', () => {
    // The 0.5 Hz high-pass pulls the end of a band-passed beat below its onset. Here the tail falls to
    // -0.1 at 230 and stays there, the lead-in stays at 0: heights are value + 0.1 and the peak is 1.1.
    const features = shapeFeatures(
      analyticShape(WAVES, piecewiseBeat([...CORNERS.slice(0, 4), [230, -0.1]])),
    );
    expect(features[3]).toBeCloseTo((130 - 25.6) / 256, 12);
    expect(features[4]).toBeCloseTo(0.5 / 1.1, 12);
    expect(features[5]).toBeCloseTo(0.6 / 1.1, 12);
    // 50% level -0.1 + 0.55 = 0.45: up at 26 + 51 × 0.45, down at 77 + 53 × 0.55/0.6.
    expect(features[1]).toBeCloseTo((77 + (53 * 0.55) / 0.6 - (26 + 51 * 0.45)) / 256, 12);
    // 25% level 0.175: up at 26 + 51 × 0.175; the first fall stays above it, the last falls through it
    // at 150 + 80 × 0.325/0.6.
    expect(features[2]).toBeCloseTo((150 + (80 * 0.325) / 0.6 - (26 + 51 * 0.175)) / 256, 12);
    // Systolic: 0.4 × (0.1 + 0.1)/2 (onset to 26) + 51 × 0.6 + 53 × 0.8 = 73.04. Diastolic: 20 × 0.55 +
    // 80 × 0.3 + 25 × 0 (230-255) + (0 + 0.1)/2 (255 to 0) + 25 × 0.1 (lead-in) + 0.6 × 0.1 = 37.61.
    expect(features[11]).toBeCloseTo(37.61 / 73.04, 12);
  });
});

describe('ML-6 shape feature names', () => {
  it('names the 12 outputs in §11.4 order', () => {
    expect(SHAPE_FEATURE_NAMES).toHaveLength(shapeFeatures(analyticShape()).length);
    expect(SHAPE_FEATURE_NAMES).toEqual([
      'riseTime',
      'width50',
      'width25',
      'notchTime',
      'notchHeight',
      'diastolicPeakHeight',
      'bOverA',
      'cOverA',
      'dOverA',
      'eOverA',
      'agingIndex',
      'areaRatio',
    ]);
  });

  it('is the same list as ml/lumen_dsp/shape_features.py SHAPE_FEATURE_NAMES', () => {
    // There is no shared file for the names, so the Python tuple is read from its source.
    const source = fs.readFileSync(path.join(__dirname, '../../../ml/lumen_dsp/shape_features.py'), 'utf8');
    const tuple = /^SHAPE_FEATURE_NAMES = \(\n([\s\S]*?)\n\)/m.exec(source);
    expect(tuple).not.toBeNull();
    const pythonNames = [...tuple![1]!.matchAll(/"(\w+)"/g)].map((match) => match[1]);
    expect(pythonNames).toEqual([...SHAPE_FEATURE_NAMES]);
  });
});

describe('ML-6 shape features: undefined values are null (core never imputes)', () => {
  it('leaves e/a and the aging index null without an e-wave; the notch comes from the beat itself', () => {
    const all = shapeFeatures(analyticShape());
    const features = shapeFeatures(analyticShape({ ...WAVES, e: null }));
    expect(features.slice(6, 9)).toEqual([-0.5, 0.25, -0.2]);
    expect([features[9], features[10]]).toEqual([null, null]);
    expect([features[3], features[4], features[5], features[11]]).toEqual([all[3], all[4], all[5], all[11]]);
  });

  it('leaves every second-derivative feature null without an a-wave', () => {
    const features = shapeFeatures(analyticShape({ a: null, b: null, c: null, d: null, e: null }));
    expect(features.slice(6, 11)).toEqual(new Array(5).fill(null));
    expect(features.slice(0, 3).every((value) => value !== null)).toBe(true);
  });

  it('nulls the ratios when the a-wave is not positive', () => {
    const shape = analyticShape();
    shape.secondDerivative[WAVES.a!] = 0;
    expect(shapeFeatures(shape).slice(6, 11)).toEqual(new Array(5).fill(null));
  });

  it('does not take the notch from the e-wave label', () => {
    const all = shapeFeatures(analyticShape());
    const features = shapeFeatures(analyticShape({ ...WAVES, e: 70 }));
    expect([features[3], features[4], features[5], features[11]]).toEqual([all[3], all[4], all[5], all[11]]);
    expect(features[9]).toBe(0); // e/a still comes from the second derivative at sample 70
  });

  // The beat decays from the notch corner (0.4 at 130) to 0 at 230 without a second maximum.
  const decayBeat = () =>
    piecewiseBeat().map((value, k) => (k > 130 ? Math.max(0, 0.4 - (k - 130) * 0.004) : value));

  it('without a visible notch, puts it at the first upward bend (positive second-derivative maximum)', () => {
    // The second derivative's only positive maximum after the peak (77) is the 0.3 at 130 (WAVE_HEIGHTS.e).
    const features = shapeFeatures(analyticShape(WAVES, decayBeat()));
    expect(features[3]).toBeCloseTo((130 - 25.6) / 256, 12);
    expect(features[4]).toBeCloseTo(0.4, 12);
    expect(features[5]).toBe(0); // no maximum after the notch
    // Diastolic: 100 × (0.4 + 0)/2 = 20 over the systolic 62.6.
    expect(features[11]).toBeCloseTo(20 / 62.6, 12);
  });

  it('does not take a minimum that no maximum follows as the notch', () => {
    // Falls to -0.1 at 180 and stays there: a minimum at 180, inside the systolic span, but no diastolic
    // peak after it, so the notch is the upward bend at 130. Heights are value + 0.1, the peak 1.1.
    const features = shapeFeatures(
      analyticShape(WAVES, piecewiseBeat([...CORNERS.slice(0, 3), [180, -0.1]])),
    );
    expect(features[3]).toBeCloseTo((130 - 25.6) / 256, 12);
    expect(features[4]).toBeCloseTo(0.5 / 1.1, 12);
    expect(features[5]).toBe(0);
  });

  it('nulls the notch features with neither a visible notch nor an upward bend in the systolic span', () => {
    // Second derivative 0 at 130: its only maximum after the peak is the 0 at 91, not positive.
    const shape = analyticShape(WAVES, decayBeat());
    shape.secondDerivative[130] = 0;
    const features = shapeFeatures(shape);
    expect([features[3], features[4], features[5], features[11]]).toEqual([null, null, null, null]);
    expect(features[9]).toBe(0);
  });

  it('does not search for the notch past the systolic span (onset + 0.7 period, sample 205)', () => {
    // The only minimum after the peak is at 210, followed by a maximum at 225; no upward bend either.
    const corners: [number, number][] = [
      [26, 0],
      [77, 1],
      [210, 0.2],
      [225, 0.3],
      [240, 0],
    ];
    const shape = analyticShape(WAVES, piecewiseBeat(corners));
    shape.secondDerivative[130] = 0;
    const features = shapeFeatures(shape);
    expect([features[3], features[4], features[5], features[11]]).toEqual([null, null, null, null]);
  });

  it('nulls everything amplitude-based on a flat beat', () => {
    const flat = new Float64Array(beatSamples).fill(0.5);
    const features = shapeFeatures({ ...analyticShape(), beat: flat, smoothed: flat });
    expect([...features.slice(0, 6), features[11]]).toEqual(new Array(7).fill(null));
  });
});

describe('ML-6 shape features on DSP-14 ensemble beats of the synthetic PPG', () => {
  // The pulse-shape.test.ts model: rise σ 40 ms, fall σ 90 ms, dicrotic wave +300 ms, morphology band.
  function syntheticBand(count: number, rrS: number) {
    const peaksS = Array.from({ length: count }, (_, i) => 1 + i * rrS);
    const wave = Array.from({ length: Math.round((count * rrS + 2) * RATE_HZ) }, (_, k) =>
      peaksS.reduce((sum, peakS) => {
        const dt = k / RATE_HZ - peakS;
        const systolic = Math.exp(-0.5 * (dt / (dt < 0 ? 0.04 : 0.09)) ** 2);
        return sum + systolic + 0.3 * Math.exp(-0.5 * ((dt - 0.3) / 0.06) ** 2);
      }, 0),
    );
    const { morphologyOrder, morphologyBandHz } = DSP_CONFIG.dsp6;
    const band = filterZeroPhase(
      butterBandpass(morphologyOrder, morphologyBandHz[0]!, morphologyBandHz[1]!, RATE_HZ),
      wave,
    );
    return { band, onsets: peaksS.map((peakS) => (peakS - 0.08) * RATE_HZ) };
  }

  function shapeAt(count: number, rrS: number): PulseShape {
    const { band, onsets } = syntheticBand(count, rrS);
    return ensembleBeat(band, onsets, new Array<boolean>(count).fill(true), 60)!;
  }

  // Pinned values, the same as ml/lumen_dsp/tests/test_shape_features.py on the same signals.
  it('gives the pinned features at 72 bpm', () => {
    const features = shapeFeatures(shapeAt(30, 0.83));
    const expected = EXPECTED_72_BPM;
    features.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));
  });

  it('is physiologically plausible at 72 bpm: notch between the peaks, positive heights and area', () => {
    const features = shapeFeatures(shapeAt(30, 0.83));
    expect(features[3]!).toBeGreaterThan(features[0]!);
    expect(features[4]!).toBeGreaterThan(0);
    expect(features[5]!).toBeGreaterThan(features[4]!); // the model has a dicrotic wave
    expect(features[11]!).toBeGreaterThan(0);
  });

  it('has no e-wave at 100 bpm: e/a and the aging index are null, the notch is still found', () => {
    const features = shapeFeatures(shapeAt(40, 0.6));
    expect([features[9], features[10]]).toEqual([null, null]);
    expect(features[4]!).toBeGreaterThan(0);
    expect(features[11]!).toBeGreaterThan(0);
  });

  it('measures the rise time to the peak of the band-passed pulse at 100 bpm', () => {
    // The model's peak is 80 ms after the onset, but the zero-phase 0.5–8 Hz morphology band delays the
    // peak of this asymmetric pulse (rise σ 40 ms, fall σ 90 ms) by about 15 ms, so the reference is the
    // band signal's own peak in a middle beat.
    const { band, onsets } = syntheticBand(40, 0.6);
    const onset = onsets[20]!;
    let peak = Math.ceil(onset);
    for (let k = peak; k < onsets[21]!; k++) if (band[k]! > band[peak]!) peak = k;
    expect(shapeFeatures(shapeAt(40, 0.6))[0]).toBeCloseTo((peak - onset) / (onsets[21]! - onset), 2);
  });
});

const EXPECTED_72_BPM = [
  0.11484375, 0.18982567830283364, 0.2743389472115185, 0.3375, 0.17173834943772825, 0.31015381425592337,
  -1.400059367713167, 0.4258455701618882, -0.35357834495426554, 0.17803459393658908, -1.6503611868573786,
  0.33386818502684,
];
