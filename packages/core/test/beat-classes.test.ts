import {
  classifyBeats,
  detectBeats,
  DSP_CONFIG,
  type ClassifiedBeat,
  type DetectedBeat,
  type RejectedSpan,
  type RejectionReason,
} from '../src';
import {
  morphologyPair,
  morphologySegment,
  parkMillerUniforms,
  ppgWave,
  regularBeats,
  withPrematureBeats,
  type SyntheticBeat,
} from './synthetic';

const { modelRateHz, shapeRateHz } = DSP_CONFIG.dsp2;
const RR_S = 60 / 72;

function classify(beats: SyntheticBeat[], seconds: number, spans: RejectedSpan[] = []): ClassifiedBeat[] {
  const { model, shape } = morphologyPair(beats, 0.3, seconds);
  return classifyBeats(detectBeats(model, shape), shape, spans);
}

function nearest(classified: ClassifiedBeat[], peakS: number): ClassifiedBeat {
  return classified.reduce((best, beat) =>
    Math.abs(beat.peakS - peakS) < Math.abs(best.peakS - peakS) ? beat : best,
  );
}

function classesOf(classified: ClassifiedBeat[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { beatClass } of classified) counts[beatClass] = (counts[beatClass] ?? 0) + 1;
  return counts;
}

// Regular beats with the interval after beat `index` replaced by `gapS`.
function withGap(index: number, gapS: number, seconds: number): SyntheticBeat[] {
  const beats: SyntheticBeat[] = [];
  for (let k = 0, peakS = 1; peakS < seconds - 1; k++) {
    beats.push({ peakS, amplitude: 1 });
    peakS += k === index ? gapS : RR_S;
  }
  return beats;
}

describe('DSP-9 not a beat', () => {
  const beats = regularBeats(1, 29, 72);
  const { model, shape } = morphologyPair(beats, 0.3, 30);
  const detected = detectBeats(model, shape);
  const sortedUpslopes = detected.map((beat) => beat.maxUpslope).sort((x, y) => x - y);
  const medianUpslope = sortedUpslopes[sortedUpslopes.length >> 1]!;

  it('marks a candidate whose maximum upslope is under 30% of the median; 30% itself is kept', () => {
    const edited = detected.map((beat, k) =>
      k === 10
        ? { ...beat, maxUpslope: 0.29 * medianUpslope }
        : k === 20
          ? { ...beat, maxUpslope: 0.3 * medianUpslope }
          : beat,
    );
    const classified = classifyBeats(edited, shape, []);
    expect(classified[10]!.beatClass).toBe('not-a-beat');
    expect(classified[20]!.beatClass).not.toBe('not-a-beat');
  });

  it('leaves not-a-beat candidates out of the intervals of the beats around them', () => {
    // A weak candidate 0.6 s after beat 10 would leave a 0.23 s interval (< 0.25 s) to beat 11.
    const weak: DetectedBeat = { ...detected[10]!, peakS: detected[10]!.peakS + 0.6, maxUpslope: 0 };
    const edited = [...detected.slice(0, 11), weak, ...detected.slice(11)];
    const classified = classifyBeats(edited, shape, []);
    expect(classified[11]!.beatClass).toBe('not-a-beat');
    expect(classified[12]!.beatClass).toBe('normal');
  });
});

describe('DSP-9 artifact', () => {
  const reasons: RejectionReason[] = [
    'motion',
    'pressure',
    'coverage',
    'coldHands',
    'quality',
    'clipping',
    'exposure',
  ];

  it.each(reasons)(
    'marks a beat inside a rejected span (%s) as an artifact and leaves its neighbours',
    (reason) => {
      const beats = regularBeats(1, 29, 72);
      const target = beats[15]!.peakS;
      const classified = classify(beats, 30, [{ startS: target - 0.05, endS: target + 0.05, reason }]);
      expect(nearest(classified, target).beatClass).toBe('artifact');
      expect(nearest(classified, target - RR_S).beatClass).toBe('normal');
      expect(nearest(classified, target + RR_S).beatClass).toBe('normal');
    },
  );

  it('marks a beat whose upstroke overlaps a rejected span as an artifact', () => {
    const beats = regularBeats(1, 29, 72);
    const target = beats[15]!.peakS;
    const classified = classify(beats, 30, [
      { startS: target - 0.12, endS: target - 0.06, reason: 'motion' },
    ]);
    expect(nearest(classified, target).beatClass).toBe('artifact');
  });

  it('marks the beat ending an interval > 2.5 s as an artifact, and not as a long pause', () => {
    const beats = withGap(12, 2.6, 30);
    const classified = classify(beats, 30);
    const after = nearest(classified, beats[13]!.peakS);
    expect(after.beatClass).toBe('artifact');
    expect(after.longPause).toBe(false);
    expect(classified.filter((beat) => beat.beatClass === 'artifact')).toHaveLength(1);
  });

  it('marks the beat ending an interval < 0.25 s as an artifact', () => {
    const beats = regularBeats(1, 29, 72);
    const { model, shape } = morphologyPair(beats, 0.3, 30);
    const detected = detectBeats(model, shape);
    const early: DetectedBeat = { ...detected[10]!, peakS: detected[10]!.peakS + 0.2 };
    const classified = classifyBeats([...detected.slice(0, 11), early, ...detected.slice(11)], shape, []);
    expect(classified[11]!.beatClass).toBe('artifact');
  });

  it('never marks AF-like irregular intervals (0.4–1.2 s) as artifacts', () => {
    const uniforms = parkMillerUniforms(400, 777);
    const beats: SyntheticBeat[] = [];
    for (let k = 0, peakS = 1; peakS < 118; peakS += 0.4 + 0.8 * uniforms[k++]!)
      beats.push({ peakS, amplitude: 1 });
    const classified = classify(beats, 120);
    expect(classified).toHaveLength(beats.length);
    expect(classesOf(classified)['artifact']).toBeUndefined();
    expect(classesOf(classified)['not-a-beat']).toBeUndefined();
  });
});

describe('DSP-9 atypical (kept)', () => {
  it('keeps a small premature beat (0.4 × amplitude at 0.7 RR) as atypical; the beat after is normal', () => {
    const beats = withPrematureBeats(RR_S, 30, [15], 0.4, 0.7);
    const classified = classify(beats, 30);
    expect(nearest(classified, beats[15]!.peakS).beatClass).toBe('atypical');
    expect(nearest(classified, beats[16]!.peakS)).toMatchObject({ beatClass: 'normal', longPause: false });
  });

  it('marks a beat more than 2× the running median amplitude as atypical', () => {
    const beats = regularBeats(1, 29, 72);
    beats[15]!.amplitude = 2.5;
    expect(nearest(classify(beats, 30), beats[15]!.peakS).beatClass).toBe('atypical');
  });

  it('marks a beat of normal size but a different shape (template correlation < 0.85) as atypical', () => {
    const beats = regularBeats(1, 29, 72);
    const odd = beats.splice(15, 1)[0]!;
    // Slow rise (σ 150 ms) and fast fall (σ 30 ms): about the same height, a different shape.
    const oddWave = (rateHz: number) =>
      ppgWave(beats, 0.3, 30, rateHz).map((value, k) => {
        const fromPeakS = k / rateHz - odd.peakS;
        return value + Math.exp(-0.5 * (fromPeakS / (fromPeakS < 0 ? 0.15 : 0.03)) ** 2);
      });
    const model = morphologySegment(oddWave(modelRateHz), modelRateHz);
    const shape = morphologySegment(oddWave(shapeRateHz), shapeRateHz);
    const detected = detectBeats(model, shape);
    const classified = classifyBeats(detected, shape, []);
    const oddBeat = nearest(classified, odd.peakS);
    // The band-pass moves the peak of this asymmetric pulse by about 26 ms.
    expect(Math.abs(oddBeat.peakS - odd.peakS)).toBeLessThan(0.05);
    expect(oddBeat.beatClass).toBe('atypical');
    const oddAmplitude = detected[classified.indexOf(oddBeat)]!.amplitude;
    const normalAmplitude = detected[classified.indexOf(oddBeat) - 2]!.amplitude;
    expect(oddAmplitude / normalAmplitude).toBeGreaterThan(0.5);
    expect(oddAmplitude / normalAmplitude).toBeLessThan(2);
  });
});

describe('DSP-9 normal and long pause', () => {
  it('classes every beat of a regular rhythm as normal with no long pause', () => {
    const classified = classify(regularBeats(1, 29, 72), 30);
    expect(classesOf(classified)).toEqual({ normal: classified.length });
    expect(classified.some((beat) => beat.longPause)).toBe(false);
  });

  it('flags an interval ≥ 1.6 × its neighbours as a long pause and keeps the beat normal', () => {
    const beats = withGap(12, 1.7 * RR_S, 30);
    const classified = classify(beats, 30);
    expect(nearest(classified, beats[13]!.peakS)).toMatchObject({ beatClass: 'normal', longPause: true });
    expect(classified.filter((beat) => beat.longPause)).toHaveLength(1);
  });

  it('does not flag a 1.5 × interval as a long pause', () => {
    const classified = classify(withGap(12, 1.5 * RR_S, 30), 30);
    expect(classified.some((beat) => beat.longPause)).toBe(false);
  });

  it('does not flag a long pause when a rejected span lies inside the interval', () => {
    const beats = withGap(12, 1.7 * RR_S, 30);
    const middleS = (beats[12]!.peakS + beats[13]!.peakS) / 2;
    const classified = classify(beats, 30, [
      { startS: middleS - 0.1, endS: middleS + 0.1, reason: 'motion' },
    ]);
    expect(nearest(classified, beats[13]!.peakS)).toMatchObject({ beatClass: 'normal', longPause: false });
  });

  it('reports onsets from DSP-8 with each class', () => {
    const classified = classify(regularBeats(1, 29, 72), 30);
    for (const beat of classified) expect(beat.peakS - beat.onsetS!).toBeGreaterThan(0.05);
  });
});
