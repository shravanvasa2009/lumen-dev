import type { BeatClass, ClassifiedBeat, RejectedSpan, RejectionReason } from '../../src';
import type { SyntheticBeat } from '../synthetic';
import {
  analyse,
  breathing,
  cameraCapture,
  draws,
  fingerPulseShape,
  matchBeats,
  physiologicalShape,
  pulseOf,
  runoff,
  sinusBeats,
  twoGaussian,
  wellInside,
  withRespiration,
  type Analysis,
  type Breathing,
  type Draws,
  type PulseShape,
} from './frames';

// §10.2 synthetic signals and the DSP-D criteria, through the full path from camera frames to classes.
const CASE_TIMEOUT_MS = 300_000;
const summary: string[] = [];
const percent = (part: number, whole: number) =>
  whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`;
afterAll(() => console.info(['DSP-D synthetic suite (measured)', ...summary].join('\n')));

type Outcome = BeatClass | 'missed';
function tally(outcomes: Outcome[]): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { normal: 0, atypical: 0, artifact: 0, 'not-a-beat': 0, missed: 0 };
  for (const outcome of outcomes) counts[outcome]++;
  return counts;
}
const outcomesOf = (matches: (ClassifiedBeat | null)[]): Outcome[] =>
  matches.map((beat) => beat?.beatClass ?? 'missed');
function describeTally(label: string, counts: Record<Outcome, number>): string {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const parts = (Object.keys(counts) as Outcome[]).map(
    (outcome) => `${outcome} ${percent(counts[outcome], total)}`,
  );
  return `${label} (n = ${total}): ${parts.join(', ')}`;
}

const spuriousDetections = (analysis: Analysis, truth: SyntheticBeat[]) =>
  analysis.beats.filter((beat) => truth.every(({ peakS }) => Math.abs(beat.peakS - peakS) > 0.1));

const fpsFor = (caseIndex: number) => (caseIndex % 2 === 0 ? 30 : 60);

// Breathing by case: pulse height ±10, 20 or 30% with baseline wander; where the rhythm is sinus, also
// respiratory sinus arrhythmia shortening RR by up to 0, 10 or 20% on inspiration.
const depthFor = (caseIndex: number) => [0.1, 0.2, 0.3][caseIndex % 3]!;
const rsaFor = (caseIndex: number) => [0, 0.1, 0.2][Math.floor(caseIndex / 3) % 3]!;

function breathingCapture(
  random: Draws,
  caseIndex: number,
  seconds: number,
  seed: number,
  pulse: (tS: number) => number,
  breath: Breathing,
) {
  const respiration = withRespiration(random, pulse, depthFor(caseIndex), breath);
  return cameraCapture({
    fps: fpsFor(caseIndex),
    seconds,
    seed,
    pulse: respiration.pulse,
    disturbance: respiration.disturbance,
  });
}

function breathingSinus(random: Draws, caseIndex: number, bpm: number, seconds: number, breath: Breathing) {
  return sinusBeats(random, bpm, 1, seconds - 1, { depth: rsaFor(caseIndex), breath });
}

function sinusTruth(random: Draws, seconds: number) {
  return sinusBeats(random, random.uniform(55, 100), 1, seconds - 1);
}

// A disturbance confined to [startS, endS] with half-cosine edges of 0.3 s.
function window(startS: number, endS: number): (tS: number) => number {
  return (tS) => {
    if (tS <= startS || tS >= endS) return 0;
    const edgeS = Math.min(tS - startS, endS - tS, 0.3);
    return 0.5 - 0.5 * Math.cos((Math.PI * edgeS) / 0.3);
  };
}

function randomSpans(random: Draws, count: number, seconds: number, reason: RejectionReason): RejectedSpan[] {
  const spans: RejectedSpan[] = [];
  for (let k = 0; k < count; k++) {
    // Spans fall in separate slices of the capture so they never overlap.
    const sliceS = (seconds - 10) / count;
    const startS = 5 + k * sliceS + random.uniform(0, sliceS - 6);
    spans.push({ startS, endS: startS + random.uniform(1, 5), reason });
  }
  return spans;
}

// Beats outside every span (and away from edges) must be found and kept; beats inside are artifacts.
function expectAcquisitionSpansOnly(
  label: string,
  cases: { analysis: Analysis; truth: SyntheticBeat[]; spans: RejectedSpan[] }[],
) {
  const outside: Outcome[] = [];
  let insideSpans = 0;
  let insideArtifacts = 0;
  for (const { analysis, truth, spans } of cases) {
    const avoid = spans.map(({ startS, endS }): [number, number] => [startS, endS]);
    outside.push(...outcomesOf(matchBeats(analysis, wellInside(analysis, truth, avoid, 1.5))));
    for (const beat of analysis.beats) {
      if (beat.beatClass === 'not-a-beat') continue;
      if (!spans.some(({ startS, endS }) => startS <= beat.peakS && endS >= (beat.onsetS ?? beat.peakS)))
        continue;
      insideSpans++;
      if (beat.beatClass === 'artifact') insideArtifacts++;
    }
  }
  const counts = tally(outside);
  summary.push(describeTally(`${label}, true beats ≥ 1.5 s from spans and edges`, counts));
  summary.push(
    `${label}, detections inside spans marked artifact: ${percent(insideArtifacts, insideSpans)} of ${insideSpans}`,
  );
  expect(insideArtifacts).toBe(insideSpans);
  expect(counts.artifact).toBe(0);
  expect((counts.normal + counts.atypical) / outside.length).toBeGreaterThanOrEqual(0.95);
}

describe('regular sinus', () => {
  it(
    'finds and keeps every beat, with no artifacts',
    () => {
      const outcomes: Outcome[] = [];
      let artifacts = 0;
      for (let c = 0; c < 20; c++) {
        const random = draws(1000 + c);
        const shape = twoGaussian(random.uniform(0.1, 0.5));
        const breath = breathing(random);
        const truth = breathingSinus(random, c, random.uniform(55, 100), 40, breath);
        const analysis = analyse(
          breathingCapture(random, c, 40, 2000 + c, pulseOf(truth, shape), breath),
          [],
        );
        outcomes.push(...outcomesOf(matchBeats(analysis, wellInside(analysis, truth, [], 1))));
        artifacts += analysis.beats.filter((beat) => beat.beatClass === 'artifact').length;
      }
      const counts = tally(outcomes);
      summary.push(describeTally('Regular sinus with breathing (AM ±10–30%, RSA 0–20%)', counts));
      expect(artifacts).toBe(0);
      expect(counts.missed + counts['not-a-beat']).toBe(0);
    },
    CASE_TIMEOUT_MS,
  );
});

describe('AF-like irregular intervals (DSP-D: never marked artifact)', () => {
  it(
    'marks no AF-like beat as an artifact',
    () => {
      const outcomes: Outcome[] = [];
      let artifacts = 0;
      for (let c = 0; c < 40; c++) {
        const random = draws(3000 + c);
        const meanRrS = random.uniform(0.5, 0.9);
        // Half the cases couple pulse size to the preceding interval (shorter filling, smaller beat).
        const coupled = c % 4 >= 2;
        const truth: SyntheticBeat[] = [];
        for (let peakS = 1, rrS = meanRrS; peakS < 59;) {
          const amplitude = coupled ? Math.min(1.2, Math.max(0.6, 0.5 + (0.5 * rrS) / meanRrS)) : 1;
          truth.push({ peakS, amplitude });
          rrS = Math.min(2, Math.max(0.3, meanRrS * (1 + 0.3 * random.normal())));
          peakS += rrS;
        }
        const shape = twoGaussian(random.uniform(0.1, 0.4));
        const analysis = analyse(
          breathingCapture(random, c, 60, 4000 + c, pulseOf(truth, shape), breathing(random)),
          [],
        );
        outcomes.push(...outcomesOf(matchBeats(analysis, wellInside(analysis, truth, [], 1))));
        artifacts += analysis.beats.filter((beat) => beat.beatClass === 'artifact').length;
      }
      const counts = tally(outcomes);
      summary.push(describeTally('AF-like (RR 0.3–2.0 s, CV 30%, AM ±10–30%)', counts));
      summary.push(`AF-like, detections marked artifact: ${artifacts}`);
      expect(artifacts).toBe(0);
      expect(counts.artifact).toBe(0);
    },
    CASE_TIMEOUT_MS,
  );
});

describe('isolated small-amplitude premature beats (DSP-D: ≥ 95% kept as atypical)', () => {
  const premature: { amplitude: number; coupling: number; outcome: Outcome }[] = [];

  beforeAll(() => {
    for (let c = 0; c < 40; c++) {
      const random = draws(5000 + c);
      const bpm = random.uniform(55, 100);
      const rrS = 60 / bpm;
      const breath = breathing(random);
      const truth = breathingSinus(random, c, bpm, 60, breath);
      const marked: { index: number; amplitude: number; coupling: number }[] = [];
      // Four premature beats, at least 8 beats apart; each replaces a sinus beat, and the next sinus beat
      // stays where it was (a compensatory pause).
      for (
        let index = 6;
        index < truth.length - 4 && marked.length < 4;
        index += 8 + Math.floor(random.uniform(0, 4))
      ) {
        const amplitude = random.uniform(0.3, 0.7);
        const coupling = random.uniform(0.55, 0.8);
        truth[index] = { peakS: truth[index - 1]!.peakS + coupling * rrS, amplitude };
        marked.push({ index, amplitude, coupling });
      }
      const shape = twoGaussian(random.uniform(0.1, 0.4));
      const analysis = analyse(breathingCapture(random, c, 60, 6000 + c, pulseOf(truth, shape), breath), []);
      const matches = matchBeats(analysis, truth);
      for (const { index, amplitude, coupling } of marked)
        premature.push({ amplitude, coupling, outcome: matches[index]?.beatClass ?? 'missed' });
    }
    summary.push(
      describeTally(
        'Premature beats (amplitude 0.3–0.7, coupling 0.55–0.8 RR)',
        tally(premature.map((beat) => beat.outcome)),
      ),
    );
    for (const [low, high] of [
      [0.3, 0.4],
      [0.4, 0.5],
      [0.5, 0.6],
      [0.6, 0.7],
    ] as const) {
      const band = premature.filter(({ amplitude }) => amplitude >= low && amplitude < high);
      summary.push(describeTally(`  amplitude ${low}–${high}`, tally(band.map((beat) => beat.outcome))));
    }
  }, CASE_TIMEOUT_MS);

  it('never marks a premature beat as an artifact', () => {
    expect(premature.filter(({ outcome }) => outcome === 'artifact')).toHaveLength(0);
  });

  it('keeps ≥ 95% of premature beats as atypical', () => {
    const atypical = premature.filter(({ outcome }) => outcome === 'atypical').length;
    expect(atypical / premature.length).toBeGreaterThanOrEqual(0.95);
  });
});

// Detections more than 0.1 s from every true peak and 0.15–0.45 s after one sit on a dicrotic wave.
function dicroticDetections(analysis: Analysis, truth: SyntheticBeat[]): ClassifiedBeat[] {
  return analysis.beats.filter(
    (beat) =>
      truth.every(({ peakS }) => Math.abs(beat.peakS - peakS) > 0.1) &&
      truth.some(({ peakS }) => beat.peakS - peakS >= 0.15 && beat.peakS - peakS <= 0.45),
  );
}

describe.each([
  {
    family: 'separate dicrotic wave (two Gaussians, ratio 0.6–1.0 drawn, ≤ 0.75 kept)',
    shapeFor: (random: Draws) =>
      twoGaussian(random.uniform(0.6, 1), random.uniform(0.25, 0.35), random.uniform(0.06, 0.1)),
  },
  {
    family: 'dicrotic hump on systolic runoff (hump 0.2–0.5)',
    shapeFor: (random: Draws) =>
      runoff(
        random.uniform(0.15, 0.3),
        random.uniform(0.2, 0.5),
        random.uniform(0.25, 0.35),
        random.uniform(0.04, 0.07),
      ),
  },
  {
    family: 'finger pulses over the four dicrotic-notch classes',
    shapeFor: (random: Draws): PulseShape => fingerPulseShape(random),
  },
])(
  'dicrotic-heavy waveforms: $family (true beats kept; dicrotic criterion is measured on real recordings, H-021)',
  ({ family, shapeFor }) => {
    let doubles = 0;
    let removed = 0;
    const trueOutcomes: Outcome[] = [];

    beforeAll(() => {
      for (let c = 0; c < 30; c++) {
        const random = draws(7000 + c);
        const shape = physiologicalShape(random, shapeFor);
        const breath = breathing(random);
        const truth = breathingSinus(random, c, random.uniform(55, 100), 40, breath);
        const analysis = analyse(
          breathingCapture(random, c, 40, 8000 + c, pulseOf(truth, shape), breath),
          [],
        );
        const extras = dicroticDetections(analysis, truth);
        doubles += extras.length;
        removed += extras.filter((beat) => beat.beatClass === 'not-a-beat').length;
        trueOutcomes.push(...outcomesOf(matchBeats(analysis, wellInside(analysis, truth, [], 1))));
      }
      summary.push(
        `Dicrotic, ${family}: ${doubles} double detections, ${percent(removed, doubles)} removed as not-a-beat`,
      );
      summary.push(describeTally(`  true beats`, tally(trueOutcomes)));
    }, CASE_TIMEOUT_MS);

    it('keeps the true beats', () => {
      const counts = tally(trueOutcomes);
      expect((counts.normal + counts.atypical) / trueOutcomes.length).toBeGreaterThanOrEqual(0.95);
    });
  },
);

describe('acquisition problems (artifacts only inside the rejected spans)', () => {
  it(
    'motion bursts',
    () => {
      const cases = Array.from({ length: 20 }, (_, c) => {
        const random = draws(9000 + c);
        const shape = twoGaussian(random.uniform(0.1, 0.5));
        const truth = sinusTruth(random, 40);
        const spans = randomSpans(random, 1 + (c % 2), 40, 'motion');
        // Motion: three random low-frequency tones, 1–4 × the pulse height, only inside the bursts.
        const tones = Array.from({ length: 3 }, () => ({
          hz: random.uniform(0.5, 4),
          phase: random.uniform(0, 2 * Math.PI),
          size: random.uniform(0.01, 0.04),
        }));
        const envelopes = spans.map(({ startS, endS }) => window(startS, endS));
        const disturbance = (tS: number) =>
          envelopes.reduce((sum, envelope) => sum + envelope(tS), 0) *
          tones.reduce((sum, { hz, phase, size }) => sum + size * Math.sin(2 * Math.PI * hz * tS + phase), 0);
        const capture = cameraCapture({
          fps: fpsFor(c),
          seconds: 40,
          seed: 10_000 + c,
          pulse: pulseOf(truth, shape),
          disturbance,
        });
        return { analysis: analyse(capture, spans), truth, spans };
      });
      expectAcquisitionSpansOnly('Motion bursts', cases);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'pressure flattening',
    () => {
      const cases = Array.from({ length: 20 }, (_, c) => {
        const random = draws(11_000 + c);
        const shape = twoGaussian(random.uniform(0.1, 0.5));
        const truth = sinusTruth(random, 40);
        const spans = randomSpans(random, 1, 40, 'pressure');
        // Pressing too hard empties the capillary bed: the pulse shrinks to 10–30% inside the span.
        const kept = random.uniform(0.1, 0.3);
        const envelope = window(spans[0]!.startS, spans[0]!.endS);
        const pulse = pulseOf(truth, shape);
        const capture = cameraCapture({
          fps: fpsFor(c),
          seconds: 40,
          seed: 12_000 + c,
          pulse: (tS) => pulse(tS) * (1 - (1 - kept) * envelope(tS)),
        });
        return { analysis: analyse(capture, spans), truth, spans };
      });
      expectAcquisitionSpansOnly('Pressure flattening', cases);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'clipping',
    () => {
      const cases = Array.from({ length: 20 }, (_, c) => {
        const random = draws(13_000 + c);
        const shape = twoGaussian(random.uniform(0.1, 0.5));
        const truth = sinusTruth(random, 40);
        const spans = randomSpans(random, 1, 40, 'clipping');
        // The red mean rises to 0.995–1.005 of full scale, so the low-blood part of each pulse clips.
        const level = random.uniform(0.995, 1.005);
        const envelope = window(spans[0]!.startS, spans[0]!.endS);
        const capture = cameraCapture({
          fps: fpsFor(c),
          seconds: 40,
          seed: 14_000 + c,
          pulse: pulseOf(truth, shape),
          redLevel: (tS) => 0.7 + (level - 0.7) * envelope(tS),
        });
        return { analysis: analyse(capture, spans), truth, spans };
      });
      expectAcquisitionSpansOnly('Clipping', cases);
    },
    CASE_TIMEOUT_MS,
  );
});

describe('cold-hand low perfusion', () => {
  it(
    'finds and keeps beats at 0.1–0.3% pulse height',
    () => {
      const outcomes: Outcome[] = [];
      const spurious: Outcome[] = [];
      for (let c = 0; c < 20; c++) {
        const random = draws(15_000 + c);
        const shape = twoGaussian(random.uniform(0.1, 0.4));
        const truth = sinusTruth(random, 40);
        const capture = cameraCapture({
          fps: fpsFor(c),
          seconds: 40,
          seed: 16_000 + c,
          pulse: pulseOf(truth, shape),
          perfusion: random.uniform(0.001, 0.003),
        });
        const analysis = analyse(capture, []);
        outcomes.push(...outcomesOf(matchBeats(analysis, wellInside(analysis, truth, [], 1))));
        spurious.push(...spuriousDetections(analysis, truth).map((beat) => beat.beatClass));
      }
      const counts = tally(outcomes);
      summary.push(describeTally('Low perfusion (0.1–0.3% of full scale, noise SD 0.02%)', counts));
      // Noise detections after the last beat, at the capture's end, may pair into an impossible interval
      // and be marked artifact; that is correct, so only true beats are held to "never artifact".
      summary.push(describeTally('  spurious detections (> 0.1 s from every true beat)', tally(spurious)));
      expect(counts.artifact).toBe(0);
      expect((counts.normal + counts.atypical) / outcomes.length).toBeGreaterThanOrEqual(0.95);
    },
    CASE_TIMEOUT_MS,
  );
});

describe('dropped frames', () => {
  it(
    'keeps beats across short gaps and splits at long ones, with no artifacts',
    () => {
      const outcomes: Outcome[] = [];
      let artifacts = 0;
      let segments = 0;
      for (let c = 0; c < 20; c++) {
        const random = draws(17_000 + c);
        const shape = twoGaussian(random.uniform(0.1, 0.4));
        const truth = sinusTruth(random, 40);
        // 5% of frames dropped at random (gaps ≤ 150 ms are interpolated), plus two 0.2–0.5 s gaps
        // (the timeline splits there, DSP-2).
        const gaps = [10, 25].map((startS): [number, number] => {
          const gapStartS = startS + random.uniform(0, 5);
          return [gapStartS, gapStartS + random.uniform(0.2, 0.5)];
        });
        const dropDraws = draws(18_000 + c);
        const keepFrame = (tS: number) =>
          dropDraws.uniform(0, 1) >= 0.05 && gaps.every(([startS, endS]) => tS < startS || tS > endS);
        const capture = cameraCapture({
          fps: fpsFor(c),
          seconds: 40,
          seed: 19_000 + c,
          pulse: pulseOf(truth, shape),
          keepFrame,
        });
        const analysis = analyse(capture, []);
        segments += analysis.segments.length;
        outcomes.push(...outcomesOf(matchBeats(analysis, wellInside(analysis, truth, gaps, 1))));
        artifacts += analysis.beats.filter((beat) => beat.beatClass === 'artifact').length;
      }
      const counts = tally(outcomes);
      summary.push(describeTally(`Dropped frames (${segments} segments over 20 captures)`, counts));
      expect(segments).toBe(60);
      expect(artifacts).toBe(0);
      expect((counts.normal + counts.atypical) / outcomes.length).toBeGreaterThanOrEqual(0.95);
    },
    CASE_TIMEOUT_MS,
  );
});
