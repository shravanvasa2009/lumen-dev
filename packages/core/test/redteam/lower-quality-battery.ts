// Red team for ADR 0104 (results at any quality, tagged lower quality): the captures, contexts, and model
// outputs both lower-quality-results.test.ts and its main-behaviour fixture are built from. Deterministic, so
// fixtures/lower-quality-main.json (made by core a1cf170, main's core before ADR 0104) stays comparable.
import type { FrameStat, PastReading, Profile, ReadingContext, RhythmOutputs, Sample } from '../../src';
import { captureAt, parkMillerUniforms, regularOffsets } from '../synthetic';
import { beatTimes, beatTrain, seededNormal } from './attacks';

export interface BatteryCapture {
  name: string;
  build: () => { samples: Sample[]; stats: FrameStat[] };
}

// Premature beat every `every` beats: 0.6 × RR, then a 1.4 × RR compensatory pause.
function ectopicIntervals(rrS: number, every: number, count: number): number[] {
  const intervalsS: number[] = [];
  for (let k = 0; k < count; k++) {
    if (k % every === every - 1) intervalsS.push(0.6 * rrS, 1.4 * rrS);
    else intervalsS.push(rrS);
  }
  return intervalsS;
}

// AF-like: independent intervals around meanS with coefficient of variation cv, none under 0.3 s.
export function afIntervals(meanS: number, cv: number, count: number, seed: number): number[] {
  const normal = seededNormal(seed);
  return Array.from({ length: count }, () => Math.max(0.3, meanS * (1 + cv * normal())));
}

const pulseCapture = (name: string, fps: number, seconds: number, intervalsS: number[]): BatteryCapture => ({
  name,
  build: () => captureAt(regularOffsets(fps, seconds), beatTrain(beatTimes(intervalsS, seconds + 5))),
});

export const BATTERY_CAPTURES: BatteryCapture[] = [
  pulseCapture('sinus 75 bpm, 95 s at 60 fps', 60, 95, [0.8]),
  pulseCapture('sinus 75 bpm, 95 s at 30 fps', 30, 95, [0.8]),
  pulseCapture('premature beat every 8th at 75 bpm, 95 s at 60 fps', 60, 95, ectopicIntervals(0.8, 8, 200)),
  pulseCapture('AF-like, mean 0.75 s, CV 0.22, 95 s at 60 fps', 60, 95, afIntervals(0.75, 0.22, 400, 7)),
  pulseCapture('sinus 75 bpm, 70 s at 60 fps (Full Scan short of 90 s)', 60, 70, [0.8]),
  pulseCapture('sinus 50 bpm, 40 s at 30 fps', 30, 40, [1.2]),
  pulseCapture('155 bpm, 70 s at 30 fps (SAFE-1 fast)', 30, 70, [60 / 155]),
  pulseCapture('35 bpm, 60 s at 30 fps (SAFE-1 slow)', 30, 60, [60 / 35]),
];

const BASE_CONTEXT: ReadingContext = {
  captureFps: 60,
  tier: 'full',
  mode: 'full',
  restTimerDone: true,
  recordedAt: { ms: 1_800_000_000_000, day: '2027-01-15' },
  motionSpans: [],
  coldHandsSpans: [],
  sqi: { threshold: 0.5, windows: [] },
  validationRhythmLabel: null,
};

export const BATTERY_CONTEXTS: { name: string; context: ReadingContext }[] = [
  { name: 'Full Scan, Full tier, 60 fps, SQI', context: BASE_CONTEXT },
  { name: 'Full Scan, Full tier, 60 fps, no SQI', context: { ...BASE_CONTEXT, sqi: null } },
  { name: 'Full Scan, Basic tier, 30 fps, SQI', context: { ...BASE_CONTEXT, tier: 'basic', captureFps: 30 } },
  { name: 'Full Scan, unrated, 60 fps, SQI', context: { ...BASE_CONTEXT, tier: null } },
  { name: 'Quick Check, Full tier, 60 fps, SQI', context: { ...BASE_CONTEXT, mode: 'quick' } },
];

export const BATTERY_PROFILES: { name: string; profile: Profile }[] = [
  { name: 'no flags', profile: { athlete: false, betaBlocker: false, pacemaker: false, knownAf: false } },
  { name: 'pacemaker', profile: { athlete: false, betaBlocker: false, pacemaker: true, knownAf: false } },
];

// One earlier positive irregular reading an hour before, and a diabetes reading the day before.
export const BATTERY_HISTORY: PastReading[] = [
  {
    atMs: 1_800_000_000_000 - 3_600_000,
    rhythmPositive: true,
    rmssdMs: 40,
    diabetes: { day: '2027-01-14', probability: 0.9, confidence: 'high' },
  },
];

// Evidence that lets every flag through, so a flag difference shows.
export const PASSED_EVIDENCE = {
  metrics: Object.fromEntries(
    ['hr', 'rhythm', 'hrv', 'resp', 'diabetes'].map((metric) => [
      metric,
      { label: 'public-data', passed: true },
    ]),
  ),
};

export const BATTERY_DIABETES = { probability: 0.8, tauDm: 0.5 };

// Seeded softmax rows; seed 3 leans to AF so the irregular rule fires on some readings.
export function batteryRhythm(rows: number, seed: number): RhythmOutputs | null {
  if (rows === 0) return null;
  const normal = seededNormal(seed);
  const windowProbs = Array.from({ length: rows }, (): [number, number, number] => {
    const logits = [2 * normal(), 2 * normal() + (seed === 3 ? 3 : 0), normal()].map(Math.exp);
    const total = logits[0]! + logits[1]! + logits[2]!;
    const sinus = logits[0]! / total;
    const af = logits[1]! / total;
    return [sinus, af, 1 - sinus - af];
  });
  return { windowProbs, tauAf: 0.25 };
}

export const BATTERY_SEEDS = [1, 3];

export interface RhythmAttack {
  name: string;
  truth: 'sinus' | 'af';
  context: ReadingContext;
  build: () => { samples: Sample[]; stats: FrameStat[] };
}

const gaussian = (x: number, centre: number, width: number) => Math.exp(-0.5 * ((x - centre) / width) ** 2);

// Beats with their own heights (a premature beat ejects less), as beatTrain otherwise.
function heightedTrain(intervalsS: number[], heights: number[], untilS: number) {
  const timesS: number[] = [];
  const beatHeights: number[] = [];
  for (let tS = -2, k = 0; tS < untilS + 2; tS += intervalsS[k % intervalsS.length]!, k++) {
    timesS.push(tS);
    beatHeights.push(heights[k % heights.length]!);
  }
  return (tS: number) => {
    let volume = 0;
    timesS.forEach((beatS, i) => {
      if (tS - beatS > -0.5 && tS - beatS < 1.2)
        volume +=
          beatHeights[i]! * (gaussian(tS - beatS, 0.12, 0.07) + 0.3 * gaussian(tS - beatS, 0.4, 0.07));
    });
    return { r: 0.6 - 0.006 * volume, g: 0.1, b: 0.05 };
  };
}

// Sinus with 4% respiratory variation and 1% noise; a premature beat (0.62 × RR, height 0.6) every `every`
// beats, followed by a full compensatory pause (PVC, 1.38 × RR) or not (PAC, 1.05 × RR).
function sinusWithEctopy(bpm: number, every: number, kind: 'pvc' | 'pac', seed: number) {
  const normal = seededNormal(seed);
  const intervalsS: number[] = [];
  const heights: number[] = [];
  for (let k = 0; intervalsS.length < 300; k++) {
    const rrS = (60 / bpm) * (1 + 0.04 * Math.sin((2 * Math.PI * k) / 4.5) + 0.01 * normal());
    if (every > 0 && k % every === every - 1) {
      intervalsS.push(0.62 * rrS, (kind === 'pvc' ? 1.38 : 1.05) * rrS);
      heights.push(1, 0.6);
    } else {
      intervalsS.push(rrS);
      heights.push(1);
    }
  }
  return { intervalsS, heights };
}

function afBeats(bpm: number, cv: number, seed: number) {
  const intervalsS = afIntervals(60 / bpm, cv, 300, seed).map((intervalS) => Math.max(0.28, intervalS));
  return { intervalsS, heights: intervalsS.map((intervalS) => Math.min(1, 0.4 + intervalS)) };
}

const RHYTHM_CONTEXT: ReadingContext = { ...BASE_CONTEXT, captureFps: 30, tier: 'basic' };

/** Quick (31 s) and sub-60 s Full (45 s) captures at 30 fps, and Full Scans with only a few seconds of beats. */
export function rhythmAttacks(): RhythmAttack[] {
  const attacks: RhythmAttack[] = [];
  const add = (
    name: string,
    truth: 'sinus' | 'af',
    mode: string,
    seconds: number,
    beats: ReturnType<typeof afBeats>,
  ) =>
    attacks.push({
      name,
      truth,
      context: { ...RHYTHM_CONTEXT, mode },
      build: () =>
        captureAt(regularOffsets(30, seconds), heightedTrain(beats.intervalsS, beats.heights, seconds)),
    });
  for (const [mode, seconds] of [
    ['quick', 31],
    ['full', 45],
  ] as const) {
    for (const bpm of [50, 60, 75, 90, 110])
      for (const [every, kind] of [
        [0, 'pvc'],
        [3, 'pvc'],
        [4, 'pac'],
        [6, 'pvc'],
        [8, 'pac'],
        [12, 'pvc'],
      ] as const)
        for (const seed of [3, 17, 101])
          add(
            `sinus ${bpm} bpm, ${kind} every ${every}, seed ${seed}, ${mode} ${seconds} s`,
            'sinus',
            mode,
            seconds,
            sinusWithEctopy(bpm, every, kind, seed),
          );
    for (const bpm of [70, 90, 120])
      for (const cv of [0.12, 0.2, 0.3])
        for (const seed of [5, 23, 77, 191])
          add(
            `AF ${bpm} bpm, CV ${cv}, seed ${seed}, ${mode} ${seconds} s`,
            'af',
            mode,
            seconds,
            afBeats(bpm, cv, seed),
          );
  }
  // The owner's floor is any beats: a Full Scan with only 4–8 s of beats gets one reading-wide row.
  for (const seconds of [4, 6, 8])
    for (const bpm of [75, 100])
      for (let seed = 1; seed <= 10; seed++) {
        add(
          `AF ${bpm} bpm, CV 0.2, seed ${seed}, full ${seconds} s`,
          'af',
          'full',
          seconds,
          afBeats(bpm, 0.2, seed),
        );
        add(
          `sinus ${bpm} bpm, pvc every 4, seed ${seed}, full ${seconds} s`,
          'sinus',
          'full',
          seconds,
          sinusWithEctopy(bpm, 4, 'pvc', seed),
        );
      }
  return attacks;
}

const PARITY_CLASSES = [
  'normal',
  'normal',
  'normal',
  'normal',
  'atypical',
  'artifact',
  'not-a-beat',
] as const;

export interface ParityInput {
  seed: number;
  // Per beat: peak s, class, long pause, amplitude, intensity, dc.
  segments: [number, string, boolean, number, number, number][][];
  intervalsS: number[];
  spansArtifact: boolean[];
  atypicalBeats: boolean[];
  morphologyPhases: number[]; // morphology256[k] = sin(2πk/205) + 0.3 sin(4πk/205 + phases[k mod 16]), 1024 samples
  onsets: number[];
  normal: boolean[];
}

export const parityMorphology = (phases: number[]) =>
  Array.from(
    { length: 1024 },
    (_, k) => Math.sin((2 * Math.PI * k) / 205) + 0.3 * Math.sin((4 * Math.PI * k) / 205 + phases[k % 16]!),
  );

/** Seeded inputs for the ADR 0104 functions: beats found twice (0 s) or reversed, artifacts, long pauses. */
export function parityInput(seed: number): ParityInput {
  const uniforms = parkMillerUniforms(3000, seed * 7919);
  let used = 0;
  const next = () => uniforms[used++]!;
  const segments: ParityInput['segments'] = [];
  let tS = 3 * next();
  // Every 4th seed: 90 normal beats breathing at 15 br/min, so DSP-13's three estimates exist.
  if (seed % 4 === 0)
    segments.push(
      Array.from({ length: 90 }, (_, b) => {
        const peakS = tS + 0.8 * b + 0.03 * Math.sin(0.5 * Math.PI * 0.8 * b);
        const breath = Math.sin(0.5 * Math.PI * peakS);
        return [peakS, 'normal', false, 0.004 * (1 + 0.1 * breath), -0.6 + 0.002 * breath, -0.6];
      }),
    );
  for (let s = 0, count = 1 + Math.floor(3 * next()); s < count; s++) {
    const segment: ParityInput['segments'][number] = [];
    for (let b = 0, beats = Math.floor(next() * (seed % 5 === 0 ? 6 : 40)); b < beats; b++) {
      const step = next();
      tS += step < 0.03 ? 0 : step < 0.05 ? -0.01 : 0.4 + next();
      const beatClass = PARITY_CLASSES[Math.floor(next() * PARITY_CLASSES.length)]!;
      segment.push([
        tS,
        beatClass,
        next() < 0.05,
        0.004 * (0.5 + next()),
        -0.6 + 0.01 * Math.sin(1.6 * tS),
        -0.6,
      ]);
    }
    segments.push(segment);
    tS += 5;
  }
  const intervalsS = Array.from({ length: 3 + Math.floor(40 * next()) }, () => 0.3 + 1.2 * next());
  const onsets = Array.from(
    { length: 1 + Math.floor(4 * next()) },
    (_, k) => 10 + 205 * k + Math.floor(40 * next()) - 20,
  );
  return {
    seed,
    segments,
    intervalsS,
    spansArtifact: intervalsS.map(() => next() < 0.08),
    atypicalBeats: [...intervalsS, 0].map(() => next() < 0.1),
    morphologyPhases: Array.from({ length: 16 }, () => 2 * Math.PI * next()),
    onsets,
    normal: onsets.map(() => next() < 0.8),
  };
}
