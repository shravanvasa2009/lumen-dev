import { classifyBeats, detectBeats, type ClassifiedBeat, type RejectedSpan } from '../../src';
import {
  analyse,
  breathing,
  cameraCapture,
  draws,
  matchBeats,
  pulseOf,
  runoff,
  sinusBeats,
  twoGaussian,
  type Analysis,
  type CameraSpec,
  type PulseShape,
} from '../synthetic-suite/frames';
import { morphologySegment, regularBeats, type SyntheticBeat } from '../synthetic';

// Runoff pulse with a dicrotic hump at 0.25 s (0.3×): a common adult finger shape (Dawber class 2).
const FINGER = runoff(0.2, 0.3, 0.25, 0.06);

function capture(
  truth: SyntheticBeat[],
  spec: Omit<CameraSpec, 'pulse' | 'seed'> & { seed?: number },
  spans: RejectedSpan[] = [],
  shape: PulseShape = FINGER,
): { analysis: Analysis; matched: (ClassifiedBeat | null)[] } {
  const analysis = analyse(cameraCapture({ seed: 3, ...spec, pulse: pulseOf(truth, shape) }), spans);
  return { analysis, matched: matchBeats(analysis, truth) };
}

const classesOf = (beats: (ClassifiedBeat | null)[]) => beats.map((beat) => beat?.beatClass ?? 'missed');

// The peak-to-onset time of beats well inside the capture: what DSP-8 gives when the foot is observed.
function interiorRiseS(beats: ClassifiedBeat[]): number {
  const rises = beats
    .slice(3, -3)
    .flatMap((beat) => (beat.onsetS === null ? [] : [beat.peakS - beat.onsetS]));
  return rises.sort((a, b) => a - b)[rises.length >> 1]!;
}

describe('red team: DSP-7/8/9 rate extremes', () => {
  it.each([
    [35, 30],
    [35, 60],
    [40, 30],
    [45, 60],
  ])('finds every beat at %i bpm (%i fps) and classes all of them normal', (bpm, fps) => {
    const truth = regularBeats(1, 59, bpm);
    const { matched } = capture(truth, { fps, seconds: 60 });
    expect(classesOf(matched)).toEqual(truth.map(() => 'normal'));
  });

  // PSVT range (§10.1 fast regular rhythm 130–220 bpm). A narrow systolic wave (σ 60 ms) keeps beats apart.
  it.each([
    [150, 30],
    [180, 30],
    [200, 30],
    [220, 30],
    [220, 60],
  ])('finds every beat at %i bpm (%i fps), none removed or marked artifact', (bpm, fps) => {
    const truth = regularBeats(1, 29, bpm);
    const { matched } = capture(truth, { fps, seconds: 30 }, [], twoGaussian(0.2));
    expect(
      classesOf(matched).filter((beatClass) => beatClass !== 'normal' && beatClass !== 'atypical'),
    ).toEqual([]);
  });

  // KNOWN LIMITATION: tachycardia with small pulses. At 220 bpm with a 0.2% pulse over 0.02% frame noise,
  // 9 of 103 beats are missed today; each miss doubles an interval (0.55 s, inside 0.25–2.5 s), which is
  // then flagged as a long pause. Bound: at least 85% found, and every long pause more than 1 s inside the
  // capture ends an interval that really holds a missed or removed (not-a-beat) true beat. Edge pauses are
  // the defect tested below.
  it('KNOWN LIMITATION: 220 bpm with a 0.2% pulse finds ≥ 85% of beats; inner long pauses span missed beats', () => {
    const truth = regularBeats(1, 29, 220);
    const { analysis, matched } = capture(
      truth,
      { fps: 30, seconds: 30, perfusion: 0.002 },
      [],
      twoGaussian(0.2),
    );
    expect(matched.filter(Boolean).length / truth.length).toBeGreaterThanOrEqual(0.85);
    const kept = analysis.beats.filter((beat) => beat.beatClass !== 'not-a-beat');
    kept.forEach((beat, i) => {
      if (!beat.longPause || i === 0) return;
      const startS = kept[i - 1]!.peakS;
      if (startS < 1 || beat.peakS > 29) return;
      const hidden = truth.filter(
        ({ peakS }, k) =>
          peakS > startS + 0.06 &&
          peakS < beat.peakS - 0.06 &&
          (matched[k]?.beatClass ?? 'not-a-beat') === 'not-a-beat',
      );
      expect(hidden.length).toBeGreaterThan(0);
    });
  });

  // DEFECT: at 30 fps a spurious candidate appears within about 0.05 s of a segment edge (0.04 s and 29.79 s
  // at 220 bpm with a 0.2% pulse, after the last true beat at 28.82 s). Its interval to the nearest true
  // beat is ≥ 1.6 × the neighbours, so DSP-9 flags a long pause ("a possibly skipped or too-weak beat") at
  // the edge of a perfectly regular rhythm in which every true beat is found.
  it.each([
    [200, 0.01],
    [220, 0.01],
    [150, 0.002],
    [180, 0.002],
  ])(
    'flags no long pause on a regular %i bpm rhythm (pulse %s of full scale) with every beat found',
    (bpm, perfusion) => {
      const truth = regularBeats(1, 29, bpm);
      const { analysis, matched } = capture(truth, { fps: 30, seconds: 30, perfusion }, [], twoGaussian(0.2));
      expect(matched.every((beat) => beat !== null && beat.beatClass !== 'not-a-beat')).toBe(true);
      expect(analysis.beats.filter((beat) => beat.longPause).map((beat) => beat.peakS)).toEqual([]);
    },
  );

  it('never marks a sudden step 60 → 150 bpm (fast pulses 0.7× as tall) as artifact', () => {
    const truth = [
      ...regularBeats(1, 15, 60),
      ...regularBeats(15.4, 29, 150).map((beat) => ({ ...beat, amplitude: 0.7 })),
    ];
    const { matched } = capture(truth, { fps: 30, seconds: 30 }, [], twoGaussian(0.2));
    expect(
      classesOf(matched).filter((beatClass) => beatClass === 'artifact' || beatClass === 'missed'),
    ).toEqual([]);
  });
});

describe('red team: DSP-7/8/9 bigeminy through the camera path', () => {
  // DEFECT (see dsp9-classes.test.ts): with a finger-shaped pulse the premature beat rides on the runoff,
  // so its measured height (peak − foot) is under half a sinus beat, and every sinus beat becomes atypical.
  it.each([75, 120])(
    'classes most sinus beats of bigeminy at %i bpm as normal (premature 0.5× at 0.6 RR)',
    (bpm) => {
      const rrS = 60 / bpm;
      const truth: SyntheticBeat[] = [];
      for (let tS = 1; tS < 28; tS += 2 * rrS)
        truth.push({ peakS: tS, amplitude: 1 }, { peakS: tS + 0.6 * rrS, amplitude: 0.5 });
      const { matched } = capture(truth, { fps: 30, seconds: 30 });
      const sinus = matched.filter((beat, k) => k % 2 === 0 && beat !== null).slice(3, -3);
      expect(
        sinus.filter((beat) => beat!.beatClass === 'normal').length / sinus.length,
      ).toBeGreaterThanOrEqual(0.9);
    },
  );
});

describe('red team: DSP-7/8/9 segment edges and gaps', () => {
  it.each([10.0, 10.3, 10.6])('flags no long pause and no artifact around a 200 ms gap at %s s', (gapS) => {
    const { analysis } = capture(regularBeats(1, 29, 72), {
      fps: 30,
      seconds: 30,
      keepFrame: (tS) => tS < gapS || tS > gapS + 0.2,
    });
    expect(analysis.segments).toHaveLength(2);
    expect(analysis.beats.filter((beat) => beat.longPause || beat.beatClass === 'artifact')).toEqual([]);
  });

  it('flags no long pause in sinus rhythm with 20% respiratory sinus arrhythmia split by three gaps', () => {
    const random = draws(21);
    const truth = sinusBeats(random, 66, 1, 59, { depth: 0.2, breath: breathing(random) });
    const { analysis } = capture(truth, {
      fps: 30,
      seconds: 60,
      keepFrame: (tS) => ![15, 30, 45].some((gapS) => tS > gapS && tS < gapS + 0.25),
    });
    expect(analysis.segments).toHaveLength(4);
    expect(analysis.beats.filter((beat) => beat.longPause)).toEqual([]);
  });

  // DEFECT: DSP-8's foot search is clipped at the segment start, so a beat whose upstroke began before the
  // segment (after a gap, or at capture start) gets the segment's first sample as its "preceding minimum"
  // and an onset placed on the segment boundary, 20–60 ms after the true onset, and stays normal. The foot
  // was not observed: the onset should be null (or the beat kept out of onset-based measures).
  it.each([
    ['frames resume at 10.90 s, 0.1 s before a peak', 10.9],
    ['frames resume at 10.93 s, 0.07 s before a peak', 10.93],
  ])('reports no fabricated onset when %s', (_label, resumeS) => {
    const { analysis } = capture(regularBeats(1, 29, 72), {
      fps: 30,
      seconds: 30,
      keepFrame: (tS) => tS < resumeS - 0.3 || tS > resumeS,
    });
    const segmentStartS = analysis.segments[1]![0];
    const first = analysis.beats.find((beat) => beat.peakS > segmentStartS)!;
    if (first.onsetS !== null)
      expect(Math.abs(first.peakS - first.onsetS - interiorRiseS(analysis.beats))).toBeLessThanOrEqual(0.01);
  });

  it('reports no fabricated onset for a beat peaking 0.1 s after capture start', () => {
    const { analysis } = capture(regularBeats(0.1, 29, 72), { fps: 30, seconds: 30 });
    const first = analysis.beats[0]!;
    if (first.onsetS !== null)
      expect(Math.abs(first.peakS - first.onsetS - interiorRiseS(analysis.beats))).toBeLessThanOrEqual(0.01);
  });

  it('keeps a small first beat (0.45×, before any template exists) atypical and the following beats normal', () => {
    const truth = regularBeats(1, 29, 72).map((beat, k) => (k === 0 ? { ...beat, amplitude: 0.45 } : beat));
    const { matched } = capture(truth, { fps: 30, seconds: 30 }, [], twoGaussian(0.2));
    expect(classesOf(matched)).toEqual(truth.map((_, k) => (k === 0 ? 'atypical' : 'normal')));
  });
});

describe('red team: DSP-7/8/9 amplitude and frame rate', () => {
  it('keeps every beat normal while the pulse drifts from 1% to 0.3% over 30 s', () => {
    const truth = regularBeats(1, 29, 72).map((beat) => ({
      ...beat,
      amplitude: 1 - (0.7 * beat.peakS) / 30,
    }));
    expect(classesOf(capture(truth, { fps: 30, seconds: 30 }).matched)).toEqual(truth.map(() => 'normal'));
  });

  it('finds the same beats with the same classes at 30 and 60 fps, peaks within 10 ms', () => {
    const truth = sinusBeats(draws(5), 70, 1, 59);
    const at30 = capture(truth, { fps: 30, seconds: 60 }).matched;
    const at60 = capture(truth, { fps: 60, seconds: 60 }).matched;
    expect(classesOf(at30)).toEqual(classesOf(at60));
    at30.forEach((beat, k) => expect(Math.abs(beat!.peakS - at60[k]!.peakS)).toBeLessThanOrEqual(0.01));
  });
});

describe('red team: DSP-7/8/9 acquisition spans', () => {
  // DEFECT: the "not a beat" floor is 0.15 × the median upslope of every candidate in the segment (ADR
  // 0025), including candidates inside rejected spans. Motion (a 5% swing at 2.3 Hz plus noise SD 0.02,
  // seed 9) from 2 s to 14 s or 20 s of a 30 s segment fills the median with motion upslopes, and every
  // clean beat after the span is removed as "not a beat" (DSP-9: "a candidate peak without a real
  // upstroke"). 2–11 s still passes. Inside the span no true beat may be normal.
  it.each([11, 14, 20])('keeps every beat more than 1 s after a 2–%i s motion span normal', (endS) => {
    const truth = regularBeats(1, 29, 72);
    const noise = draws(9);
    const { matched } = capture(
      truth,
      {
        fps: 30,
        seconds: 30,
        disturbance: (tS) =>
          tS > 2 && tS < endS ? 0.05 * Math.sin(2 * Math.PI * 2.3 * tS) + 0.02 * noise.normal() : 0,
      },
      [{ startS: 2, endS, reason: 'motion' }],
    );
    const after = matched.filter((_, k) => truth[k]!.peakS > endS + 1);
    expect(classesOf(after)).toEqual(after.map(() => 'normal'));
    const inside = matched.filter((_, k) => truth[k]!.peakS > 2.2 && truth[k]!.peakS < endS - 0.2);
    expect(classesOf(inside).filter((beatClass) => beatClass === 'normal')).toEqual([]);
  });

  // KNOWN LIMITATION (spec rule DSP-5): a 0.1 exposure step (10× the pulse) at 12 s. Zero-phase filtering
  // spreads its transient before the step, but DSP-5 marks only the following 1 s, so the beat at 11.83 s,
  // outside every span, is lost today. The interval that hides it ends at a non-artifact beat; only the
  // span overlap tells DSP-11/DSP-15 to drop it. Bound: beats are lost only within 1 s before the span.
  it('KNOWN LIMITATION: an exposure step loses beats only within 1 s before its DSP-5 span; beats 1 s away stay normal', () => {
    const truth = regularBeats(1, 29, 72);
    const { matched } = capture(truth, { fps: 30, seconds: 30, redLevel: (tS) => (tS < 12 ? 0.7 : 0.6) }, [
      { startS: 12, endS: 13, reason: 'exposure' },
    ]);
    truth.forEach(({ peakS }, k) => {
      const beatClass = matched[k]?.beatClass ?? 'missed';
      if (peakS < 11 || peakS > 14) expect(beatClass).toBe('normal');
      else if (peakS >= 12 && peakS <= 13) expect(['artifact', 'missed']).toContain(beatClass);
      else if (peakS < 12) expect(['normal', 'missed']).toContain(beatClass);
    });
  });
});

describe('red team: DSP-7/8 degenerate input', () => {
  it('returns no beats for an empty segment', () => {
    const empty = { firstIndex: 0, values: new Float64Array(0) };
    expect(detectBeats(empty, empty)).toEqual([]);
  });

  it('never returns a non-finite beat when one sample of the filtered signal is NaN', () => {
    const sine = (rateHz: number) =>
      Array.from({ length: 10 * rateHz }, (_, k) => Math.sin((2 * Math.PI * 1.2 * k) / rateHz));
    const model = sine(64);
    const shape = sine(256);
    model[300] = NaN;
    shape[1200] = NaN;
    const beats = detectBeats(morphologySegment(model, 64), morphologySegment(shape, 256));
    const nonFinite = beats.filter(({ peakS, amplitude, maxUpslope }) =>
      [peakS, amplitude, maxUpslope].some((value) => !Number.isFinite(value)),
    );
    expect(nonFinite).toEqual([]);
  });

  it('finds and keeps a lone beat in a 3 s segment', () => {
    const waveAt = (rateHz: number) => Array.from({ length: 3 * rateHz }, (_, k) => FINGER(k / rateHz - 1.5));
    const shape = morphologySegment(waveAt(256), 256);
    const beats = detectBeats(morphologySegment(waveAt(64), 64), shape);
    expect(beats).toHaveLength(1);
    expect(classifyBeats(beats, shape, [])).toMatchObject([{ beatClass: 'normal', longPause: false }]);
  });
});
