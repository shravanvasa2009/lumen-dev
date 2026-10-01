import { classifyBeats, type ClassifiedBeat, type DetectedBeat, type RejectedSpan } from '../../src';

// A flat 256 Hz segment gives no template correlation (correlation is null when a side is flat), so these
// cases isolate the interval and amplitude rules of DSP-9.
const NO_SHAPE = { firstIndex: 0, values: new Float64Array(256 * 120) };

// Every beat rises 0.1 s before its peak with the same upslope; amplitudes in units of a sinus beat.
function detected(peaksS: number[], amplitudes: number[] = []): DetectedBeat[] {
  return peaksS.map((peakS, i) => ({
    peakS,
    onsetS: peakS - 0.1,
    maxUpslope: 1,
    amplitude: amplitudes[i] ?? 1,
  }));
}

// A repeating rhythm: beat k has amplitude pattern[k].amplitude and follows the previous beat after
// pattern[k].rrFraction × RR. Starts at 2 s.
function rhythm(bpm: number, count: number, pattern: { rrFraction: number; amplitude: number }[]) {
  const rrS = 60 / bpm;
  const peaksS: number[] = [];
  const amplitudes: number[] = [];
  for (let k = 0, tS = 2; k < count; k++) {
    const { amplitude } = pattern[k % pattern.length]!;
    peaksS.push(tS);
    amplitudes.push(amplitude);
    tS += pattern[(k + 1) % pattern.length]!.rrFraction * rrS;
  }
  return { peaksS, amplitudes };
}

// Sinus beat, then a premature beat at 0.6 RR, then the compensatory 1.4 RR back to the sinus beat.
const bigeminy = (prematureAmplitude: number) => [
  { rrFraction: 1.4, amplitude: 1 },
  { rrFraction: 0.6, amplitude: prematureAmplitude },
];

const classify = (beats: DetectedBeat[], spans: RejectedSpan[] = []) => classifyBeats(beats, NO_SHAPE, spans);
// Beats at least `margin` beats from either end, where both sides have their full 5 neighbours.
const interior = <T>(items: T[], margin = 6) => items.slice(margin, items.length - margin);

describe('red team: DSP-9 bigeminy (55–120 bpm)', () => {
  // DEFECT: the amplitude reference is the median of 5 neighbours on each side with the beat itself left
  // out (ADR 0025). In an alternating rhythm those 10 neighbours are 6 of the other kind and 4 of the same
  // kind, so a sinus beat's reference is the premature amplitude. When the premature beat is under half a
  // sinus beat, every sinus beat is "> 2.0 × the running median" and becomes atypical: the whole rhythm
  // is atypical, no beat is normal, and the template never forms. A centred reference with an even count
  // per side (4 + 4) gives 0.725 here, and sinus beats are normal (ratio 1.38).
  it.each([55, 75, 90, 120])(
    'keeps the sinus beats normal at %i bpm with premature beats at 0.45×',
    (bpm) => {
      const { peaksS, amplitudes } = rhythm(bpm, 40, bigeminy(0.45));
      const sinusClasses = interior(classify(detected(peaksS, amplitudes))).filter((_, k) => k % 2 === 0);
      expect(sinusClasses.map((beat) => beat.beatClass)).toEqual(sinusClasses.map(() => 'normal'));
    },
  );

  it.each([55, 75, 90, 120])('keeps every premature beat (0.45×, 0.6 RR) at %i bpm as atypical', (bpm) => {
    const { peaksS, amplitudes } = rhythm(bpm, 40, bigeminy(0.45));
    const premature = classify(detected(peaksS, amplitudes)).filter((_, k) => k % 2 === 1);
    expect(premature.map((beat) => beat.beatClass)).toEqual(premature.map(() => 'atypical'));
  });

  it('keeps the sinus beats normal when the premature beats are 0.55× (the reference bias stays in range)', () => {
    const { peaksS, amplitudes } = rhythm(75, 40, bigeminy(0.55));
    const sinusClasses = interior(classify(detected(peaksS, amplitudes))).filter((_, k) => k % 2 === 0);
    expect(sinusClasses.map((beat) => beat.beatClass)).toEqual(sinusClasses.map(() => 'normal'));
  });

  // DEFECT (same cause, needs the owner's reading of "median of its neighbors"): the compensatory 1.4 RR
  // interval is compared with the median of 5 intervals on each side, itself excluded: 6 short (0.6 RR)
  // and 4 long, so the reference is 0.6 RR and 1.4 ≥ 1.6 × 0.6. Every compensatory interval of the
  // segment is then a "long pause" (DSP-9: "a possibly skipped or too-weak beat", excluded from HRV)
  // although no beat was skipped and every interval is < 1.6 × the rhythm's 1.0 RR.
  it.each([55, 75, 90, 120])(
    'flags no compensatory interval of bigeminy at %i bpm as a long pause',
    (bpm) => {
      const { peaksS, amplitudes } = rhythm(bpm, 40, bigeminy(0.6));
      const flagged = interior(classify(detected(peaksS, amplitudes))).filter((beat) => beat.longPause);
      expect(flagged.map((beat) => beat.peakS)).toEqual([]);
    },
  );

  it('classes trigeminy (1.4 / 1.0 / 0.6 RR, premature 0.5×) as normal, normal, atypical with no long pause', () => {
    const { peaksS, amplitudes } = rhythm(75, 45, [
      { rrFraction: 1.4, amplitude: 1 },
      { rrFraction: 1.0, amplitude: 1 },
      { rrFraction: 0.6, amplitude: 0.5 },
    ]);
    const classes = classify(detected(peaksS, amplitudes));
    expect(classes.map((beat) => beat.beatClass)).toEqual(
      classes.map((_, k) => (k % 3 === 2 ? 'atypical' : 'normal')),
    );
    expect(classes.filter((beat) => beat.longPause)).toEqual([]);
  });
});

describe('red team: DSP-9 long pause against artifact (missed beat)', () => {
  it('flags a missed beat at 60 bpm (a 2.0 s interval) as a long pause and keeps the beat normal', () => {
    const peaksS = Array.from({ length: 30 }, (_, k) => 2 + k).filter((_, k) => k !== 15);
    const after = classify(detected(peaksS))[15]!;
    expect(after).toMatchObject({ beatClass: 'normal', longPause: true });
  });

  it('marks a missed beat at 40 bpm (a 3.0 s interval, > 2.5 s) as an artifact, not a long pause', () => {
    const peaksS = Array.from({ length: 30 }, (_, k) => 2 + 1.5 * k).filter((_, k) => k !== 15);
    expect(classify(detected(peaksS))[15]).toMatchObject({ beatClass: 'artifact', longPause: false });
  });

  it.each([
    [0.2499, 'artifact'],
    [0.25, 'normal'],
    [2.5, 'normal'],
    [2.5001, 'artifact'],
  ])(
    'classes the beat ending a %s s interval as %s (DSP-9 limits 0.25 and 2.5 s)',
    (intervalS, beatClass) => {
      const peaksS = [2, 3, 4, 5, 5 + intervalS, 6 + intervalS, 7 + intervalS];
      expect(classify(detected(peaksS))[4]!.beatClass).toBe(beatClass);
    },
  );

  it('never marks sudden rate steps 60 → 150 → 50 bpm as artifact or long pause, even with smaller fast beats', () => {
    const peaksS: number[] = [];
    const amplitudes: number[] = [];
    let tS = 2;
    for (const [count, rrS, amplitude] of [
      [20, 1.0, 1],
      [30, 0.4, 0.6],
      [15, 1.2, 1],
    ] as const) {
      for (let k = 0; k < count; k++, tS += rrS) {
        peaksS.push(tS);
        amplitudes.push(amplitude);
      }
    }
    const classes = classify(detected(peaksS, amplitudes));
    expect(classes.filter((beat) => beat.beatClass === 'artifact' || beat.longPause)).toEqual([]);
  });
});

describe('red team: DSP-9 rejected spans at beat edges', () => {
  const second = Array.from({ length: 12 }, (_, k) => 2 + k);
  const span = (startS: number, endS: number, reason: RejectedSpan['reason']): RejectedSpan => ({
    startS,
    endS,
    reason,
  });
  const artifactPeaks = (spans: RejectedSpan[]) =>
    classify(detected(second), spans).flatMap((beat) => (beat.beatClass === 'artifact' ? [beat.peakS] : []));

  it('marks every beat whose upstroke [onset, peak] meets the 1 s after an exposure change (DSP-5)', () => {
    // Beat 7 rises from 6.9 s, inside the span that ends at 6.95 s.
    expect(artifactPeaks([span(5.95, 6.95, 'exposure')])).toEqual([6, 7]);
    expect(artifactPeaks([span(5.5, 6.5, 'exposure')])).toEqual([6]);
  });

  it('marks a beat whose upstroke a motion span ends inside (1 ms after the onset)', () => {
    expect(artifactPeaks([span(4.5, 4.901, 'motion')])).toEqual([5]);
  });

  it('does not mark a beat whose onset comes 1 ms after a motion span ends', () => {
    expect(artifactPeaks([span(4.5, 4.899, 'motion')])).toEqual([]);
  });

  it('marks neither beat around a motion span that falls between them, and flags no long pause', () => {
    const classes = classify(detected(second), [span(5.2, 5.8, 'motion')]);
    expect(classes.filter((beat) => beat.beatClass !== 'normal' || beat.longPause)).toEqual([]);
  });
});

describe('red team: DSP-9 degenerate segments', () => {
  it('returns nothing for an empty segment', () => {
    expect(classify([])).toEqual([]);
  });

  it.each([1, 2])('classes a segment of %i beat(s) as normal with no long pause', (count) => {
    const classes = classify(detected([5, 6].slice(0, count)));
    expect(classes.map((beat) => [beat.beatClass, beat.longPause])).toEqual(
      classes.map(() => ['normal', false]),
    );
  });

  it('keeps a small first beat (0.45×, before any template or interval) as atypical and the rest normal', () => {
    const peaksS = Array.from({ length: 12 }, (_, k) => 2 + k);
    const classes = classify(detected(peaksS, [0.45]));
    expect(classes.map((beat) => beat.beatClass)).toEqual(
      classes.map((_, k) => (k === 0 ? 'atypical' : 'normal')),
    );
  });

  // DEFECT: a beat with a NaN time, amplitude or upslope is classed normal: NaN fails every comparison, so
  // no rule fires. Its intervals are NaN and would reach DSP-11 and DSP-15 as a clean beat. The beat must
  // be refused (RangeError) or kept out of the clean beats (artifact or not a beat).
  it.each([
    ['peakS', { peakS: NaN }],
    ['amplitude', { amplitude: NaN }],
    ['maxUpslope', { maxUpslope: NaN }],
  ])('never classes a beat with a NaN %s as normal or atypical', (_field, badValue) => {
    const beats = detected(Array.from({ length: 12 }, (_, k) => 2 + k));
    beats[5] = { ...beats[5]!, ...badValue };
    let classes: ClassifiedBeat[] | null = null;
    try {
      classes = classify(beats);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    if (classes) expect(['artifact', 'not-a-beat']).toContain(classes[5]!.beatClass);
  });
});
