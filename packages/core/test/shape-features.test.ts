import {
  butterBandpass,
  DSP_CONFIG,
  ensembleBeat,
  filterZeroPhase,
  shapeFeatures,
  type PulseShape,
  type WaveLabels,
} from '../src';

const { beatSamples, leadFraction } = DSP_CONFIG.dsp14;
const RATE_HZ = DSP_CONFIG.dsp2.shapeRateHz;

// Piecewise-linear beat through these (sample, height) corners, flat outside them. The onset sits at
// sample 25.6 (lead fraction 0.1 × 256) on the flat foot, so the onset level is exactly 0 and every
// crossing and trapezoid below is exact. Same corners as ml/lumen_dsp/tests/test_shape_features.py.
const CORNERS: [number, number][] = [
  [26, 0],
  [77, 1], // systolic peak
  [130, 0.4], // dicrotic notch
  [150, 0.5], // diastolic peak
  [230, 0],
];

function piecewiseBeat(): Float64Array {
  return Float64Array.from({ length: beatSamples }, (_, k) => {
    if (k <= CORNERS[0]![0] || k >= CORNERS[CORNERS.length - 1]![0]) return 0;
    const segment = CORNERS.findIndex(([corner]) => corner >= k);
    const [k0, v0] = CORNERS[segment - 1]!;
    const [k1, v1] = CORNERS[segment]!;
    return v0 + ((v1 - v0) * (k - k0)) / (k1 - k0);
  });
}

const WAVES: WaveLabels = { a: 30, b: 40, c: 60, d: 90, e: 130 };
const WAVE_HEIGHTS = { a: 2, b: -1, c: 0.5, d: -0.4, e: 0.3 };

function analyticShape(waves: WaveLabels = WAVES): PulseShape {
  const beat = piecewiseBeat();
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
    expect(features[3]).toBeCloseTo((130 - 25.6) / 256, 12); // notch time (the e-wave)
  });

  it('measures peak widths at 50% and 25% of the peak height by linear interpolation', () => {
    // 50%: up at 26 + 51/2, down on the first fall (1 → 0.4 over 53 samples) at 77 + 53 × 0.5/0.6.
    expect(features[1]).toBeCloseTo((77 + (53 * 0.5) / 0.6 - 51.5) / 256, 12);
    // 25%: up at 26 + 51/4; the first fall stays above 0.25, so down on the last fall at 150 + 80/2.
    expect(features[2]).toBeCloseTo((190 - 38.75) / 256, 12);
  });

  it('gives notch and diastolic peak heights relative to the systolic peak above the onset level', () => {
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
});

describe('ML-6 shape features: undefined values are null (core never imputes)', () => {
  it('leaves notch-based features and e/a null when there is no e-wave; 0 diastolic peak only if none', () => {
    const features = shapeFeatures(analyticShape({ ...WAVES, e: null }));
    expect(features[0]).not.toBeNull();
    expect(features.slice(6, 9)).toEqual([-0.5, 0.25, -0.2]);
    expect([features[3], features[4], features[5], features[9], features[10], features[11]]).toEqual(
      new Array(6).fill(null),
    );
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

  it('nulls notch features when the e-wave is not after the systolic peak', () => {
    const features = shapeFeatures(analyticShape({ ...WAVES, e: 70 }));
    expect([features[3], features[4], features[5], features[11]]).toEqual([null, null, null, null]);
    expect(features[9]).toBe(0); // e/a still comes from the second derivative at sample 70
  });

  it('gives a diastolic peak height of 0 when the beat decays without a second maximum', () => {
    const shape = analyticShape();
    const decay = shape.beat.map((value, k) => (k > 130 ? Math.max(0, 0.4 - (k - 130) * 0.004) : value));
    expect(shapeFeatures({ ...shape, beat: decay, smoothed: decay })[5]).toBe(0);
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

  it('has no e-wave at 100 bpm, so the notch features are null', () => {
    const features = shapeFeatures(shapeAt(40, 0.6));
    expect([features[3], features[4], features[5], features[9], features[10], features[11]]).toEqual(
      new Array(6).fill(null),
    );
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
  0.11484375, 0.16451583897228794, 0.22346678237348439, 0.59140625, -0.13966421024181777, 0,
  -1.4000593677131694, 0.42584557016188307, -0.3535783449542628, 0.17803459393658358, -1.650361186857373,
  -0.45148603546110394,
];
