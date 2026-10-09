import {
  analyzeReading,
  buildReadingResult,
  butterBandpass,
  CausalFilter,
  cleanSeconds,
  createLiveSession,
  displayPulse,
  DSP_CONFIG,
  emergencyHeartRate,
  readingOutcome,
  rhythmModelRows,
  type CaptureStatus,
  type FrameStat,
  type ModelOutputs,
  type Profile,
  type ReadingAnalysis,
  type ReadingContext,
  type ReadingResult,
  type Sample,
} from '../../src';
import mainFixture from './fixtures/lower-quality-main.json';
import { captureAt, regularOffsets } from '../synthetic';
import { beatTimes, beatTrain, flatRed, type Channels } from './attacks';
import {
  BATTERY_CAPTURES,
  BATTERY_CONTEXTS,
  BATTERY_DIABETES,
  BATTERY_HISTORY,
  BATTERY_PROFILES,
  BATTERY_SEEDS,
  batteryRhythm,
  PASSED_EVIDENCE,
} from './lower-quality-battery';

// Red team (§16) for ADR 0104 on track/dsp-hr-headline-pulse (78fdcf5, 5f7730d, 3ad37eb). The owner's rules
// are taken as given: every check gives a result from the beats, tagged lower quality with reasons; Quick runs
// everything; a lower-quality irregular call may show possible AFib; the floor is any beats at all. These tests
// look for failures inside those rules. A `test.failing` case states the behaviour the red team expects and
// passes while the code still fails it; when a fix lands it turns red, and the fixer makes it a plain test.

type MetricKey = keyof ReadingResult['metrics'];
const METRIC_KEYS: MetricKey[] = ['hr', 'rhythm', 'rmssd', 'resp', 'diabetes'];
type Tagged = { quality: string; qualityReasons: string[]; confidence?: string };

const withoutTag = (metric: object) => {
  const rest: Record<string, unknown> = { ...metric };
  delete rest.quality;
  delete rest.qualityReasons;
  delete rest.qualityDetails;
  return rest;
};

// Every number in the Results JSON must be finite: JSON.stringify writes NaN and Infinity as null.
function nonFinitePaths(value: unknown, path = 'result'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (value !== null && typeof value === 'object')
    return Object.entries(value).flatMap(([key, inner]) => nonFinitePaths(inner, `${path}.${key}`));
  return [];
}

interface MainCase {
  capture: string;
  context: string;
  seed: number;
  profile: string;
  outcome: string;
  urgent: unknown;
  headlineKey: string;
  metrics: Record<MetricKey, Record<string, unknown> | null>;
}

// The battery's SQI contexts hold no scores, which before SQI-Net was advisory meant no window vetoed. Since the
// owner's 2026-10-09 ruling a rate SQI-Net never scored is tagged, so here SQI-Net passes one window a second, as
// the app sends them; a score rejects nothing, so the analysis is otherwise the same.
function scoredContext(capture: { samples: Sample[] }, context: ReadingContext): ReadingContext {
  if (context.sqi === null) return context;
  const firstNs = capture.samples[0]!.tNs;
  const lastS = (capture.samples[capture.samples.length - 1]!.tNs - firstNs) / 1e9;
  const windowS = DSP_CONFIG.dsp3.modelWindowS;
  const windows = Array.from({ length: Math.max(0, Math.floor(lastS) - windowS + 1) }, (_, k) => ({
    endNs: firstNs + (k + windowS) * 1e9,
    pClean: 0.9,
  }));
  return { ...context, sqi: { ...context.sqi, windows } };
}

// The battery analysed once per context; each analysis takes 0.1–1 s.
const analyses = new Map<string, ReadingAnalysis>();
function batteryAnalysis(captureName: string, contextName: string): ReadingAnalysis {
  const key = `${captureName} | ${contextName}`;
  if (!analyses.has(key)) {
    const capture = BATTERY_CAPTURES.find(({ name }) => name === captureName)!.build();
    const { context } = BATTERY_CONTEXTS.find(({ name }) => name === contextName)!;
    analyses.set(key, analyzeReading(capture, scoredContext(capture, context)));
  }
  return analyses.get(key)!;
}

const profileNamed = (name: string) => BATTERY_PROFILES.find((entry) => entry.name === name)!.profile;

function batteryResult(analysis: ReadingAnalysis, seed: number, profile: Profile): ReadingResult {
  const models: ModelOutputs = {
    rhythm: batteryRhythm(rhythmModelRows(analysis).length, seed),
    diabetes: BATTERY_DIABETES,
  };
  return buildReadingResult(analysis, models, PASSED_EVIDENCE, profile, BATTERY_HISTORY);
}

const MAIN_CASES = mainFixture.cases as MainCase[];

describe('red team ADR 0104: the standard path is main’s (fixture made by core a1cf170)', () => {
  // 8 captures × 5 contexts × 2 rhythm seeds × 2 profiles, every flag allowed by evidence. Urgent and outcome
  // always match; every metric main showed is unchanged and standard, on a Quick Check too, which since the
  // owner's answer 4 (2026-10-06) tags only a value that misses a floor.
  it.each(
    MAIN_CASES.map((main) => [
      `${main.capture} | ${main.context} | seed ${main.seed} | ${main.profile}`,
      main,
    ]),
  )(
    '%s',
    (_, main) => {
      const analysis = batteryAnalysis(main.capture, main.context);
      const outcome = readingOutcome(analysis);
      expect(outcome.urgent).toEqual(main.urgent);
      if (main.outcome === 'reading') expect(outcome.kind).toBe('reading');
      const built = batteryResult(analysis, main.seed, profileNamed(main.profile));
      for (const key of METRIC_KEYS) {
        const before = main.metrics[key];
        const after = built.metrics[key] as (Tagged & object) | null;
        if (before === null) {
          // On a Quick Check a value meeting every floor is standard; the diabetes pattern's floors include a
          // Full Scan (§11.4), so it stays tagged there.
          const floorsMet = analysis.context.mode === 'quick' && key !== 'diabetes';
          if (after !== null && !floorsMet) expect(after.quality).toBe('low');
          continue;
        }
        expect(after).not.toBeNull();
        // Owner 2026-10-09: a rate SQI-Net never scored is tagged noSqi, and nothing else about it changes.
        if (key === 'hr' && !analysis.sqiAvailable)
          expect(after).toMatchObject({ quality: 'low', qualityReasons: ['noSqi'] });
        else expect(after!.quality).toBe('standard');
        expect(withoutTag(after!)).toEqual(before);
      }
      // 78fdcf5: an unjudged rhythm states only the rate instead of "Couldn't tell".
      const rhythm = built.metrics.rhythm;
      if (main.outcome === 'reading' && (rhythm === null || rhythm.quality === 'standard')) {
        const expected =
          main.headlineKey === 'result.uncertain' && main.metrics.rhythm === null
            ? 'result.hrOnly'
            : main.headlineKey;
        expect(built.headlineKey).toBe(expected);
      }
    },
    60_000,
  );
});

// Extra captures for the tag checks: short, gapped, and broken signals reach the lower-quality path.
const pulse = (bpm: number, untilS: number): Channels => beatTrain(beatTimes([60 / bpm], untilS));
const EDGE_CAPTURES: [string, () => { samples: Sample[]; stats: FrameStat[] }][] = [
  ['2.2 s at 75 bpm (2 intervals)', () => captureAt(regularOffsets(30, 2.2), pulse(75, 3))],
  ['3 s at 75 bpm', () => captureAt(regularOffsets(30, 3), pulse(75, 3))],
  ['6 s at 75 bpm', () => captureAt(regularOffsets(30, 6), pulse(75, 6))],
  ['10 s at 75 bpm', () => captureAt(regularOffsets(60, 10), pulse(75, 10))],
  ['12 s on of 40 s at 35 bpm', () => captureAt(regularOffsets(30, 12), pulse(35, 12))],
  ['20 s at 30 bpm', () => captureAt(regularOffsets(30, 20), pulse(30, 20))],
  [
    '8 s, a 20 s gap, 8 s at 75 bpm',
    () => captureAt([...regularOffsets(30, 8), ...regularOffsets(30, 8).map((tS) => tS + 28)], pulse(75, 40)),
  ],
  [
    'every 7th frame NaN, 30 s at 75 bpm',
    () => {
      const frames = captureAt(regularOffsets(30, 30), pulse(75, 30));
      frames.samples.forEach((sample, i) => {
        if (i % 7 === 0) sample.r = NaN;
      });
      return frames;
    },
  ],
  ['30 s flat (no pulse)', () => captureAt(regularOffsets(30, 30), flatRed(0.6))],
];

// A context whose tier matches its frame rate (§5.2): the reasons' fps fields are judged on these.
const TAG_CONTEXTS = BATTERY_CONTEXTS.filter(
  ({ context }) => context.tier === null || context.captureFps >= 60 === (context.tier === 'full'),
);

function expectHonestTags(built: ReadingResult, context: ReadingContext) {
  expect(nonFinitePaths(built)).toEqual([]);
  const readingKinds = built.quality.reasons.map((reason) => reason.kind);
  expect(new Set(readingKinds).size).toBe(readingKinds.length);
  const tagged = [
    ...METRIC_KEYS.map((key) => built.metrics[key] as (Tagged & object) | null),
    built.experimental as Tagged,
  ].filter((metric): metric is Tagged => metric !== null);
  // SQI-Net's own reasons are advisory (owner 2026-10-06 and 2026-10-09): readingConfidence caps them at moderate.
  // noSqi is advisory on the heart rate only; on a rhythm call it is a confidence shortfall, as before.
  const advisory = (metric: Tagged, kind: string) =>
    kind === 'sqiFlagged' || kind === 'sqiUnscored' || (kind === 'noSqi' && metric === built.metrics.hr);
  for (const metric of tagged) {
    expect(metric.quality === 'low').toBe(metric.qualityReasons.length > 0);
    const floorMissed = metric.qualityReasons.some((kind) => !advisory(metric, kind));
    if (floorMissed && metric.confidence !== undefined) expect(metric.confidence).toBe('low');
    if (metric.quality === 'low' && !floorMissed && metric.confidence !== undefined)
      expect(metric.confidence).not.toBe('high');
    for (const kind of metric.qualityReasons) expect(readingKinds).toContain(kind);
  }
  const metricKinds = new Set(tagged.flatMap((metric) => metric.qualityReasons));
  for (const kind of readingKinds) expect(metricKinds.has(kind)).toBe(true);
  expect(built.quality.level === 'low').toBe(tagged.some((metric) => metric.quality === 'low'));
  // ML-6 (ADR 0104): a lower-quality diabetes pattern never flags.
  if (built.metrics.diabetes?.flag) expect(built.metrics.diabetes.quality).toBe('standard');
  for (const reason of built.quality.reasons) {
    if (reason.kind === 'shortClean') expect(reason.haveS).toBeLessThan(reason.wantS);
    if (reason.kind === 'fewBeats') expect(reason.beats).toBeLessThan(reason.wantBeats);
    if (reason.kind === 'lowFps' && Number.isFinite(context.captureFps))
      expect(reason.fps).toBeLessThan(reason.wantFps);
  }
  const rhythmWindows = built.quality.reasons.find((reason) => reason.kind === 'fewWindows');
  if (rhythmWindows?.kind === 'fewWindows' && built.metrics.resp?.quality !== 'low')
    expect(rhythmWindows.windows).toBeLessThan(rhythmWindows.wantWindows);
}

// Owner 2026-10-06 (ADR 0104 answers 2 and 5): a reading-wide rhythm row under 20 intervals gives no class and no
// flag; a retake prompt appears exactly on a lower-quality rate under 40 or over 150 bpm.
function expectRhythmJudgedFromEnoughIntervals(built: ReadingResult, analysis: ReadingAnalysis) {
  const rhythm = built.metrics.rhythm;
  const wide = analysis.lowQuality.rhythmWindow;
  const tooShort = analysis.rhythmFeatures.length === 0 && wide !== null && wide.intervalsS.length < 20;
  if (rhythm !== null) expect(rhythm.class === null).toBe(tooShort);
  if (rhythm?.class === null) {
    expect(rhythm).toMatchObject({ pAF: null, flag: null, quality: 'low' });
    expect(built.headlineKey).toBe('result.hrOnly');
  }
  // Red team on #299: the prompt is for a rate only the lower-quality path found, never a standard one.
  const hr = built.metrics.hr;
  const extreme = hr !== null && analysis.heartRateBpm === null && (hr.value < 40 || hr.value > 150);
  expect(built.retakePrompt !== null).toBe(extreme);
}

describe('red team ADR 0104: every lower-quality value carries its tag and honest reasons', () => {
  const rhythmVariants = (rows: number) => [
    null,
    ...BATTERY_SEEDS.map((seed) => batteryRhythm(rows, seed)),
    rows > 0 ? { ...batteryRhythm(rows, 3)!, basicAnalysis: true } : null,
  ];
  it.each([...BATTERY_CAPTURES.map(({ name }) => name), ...EDGE_CAPTURES.map(([name]) => name)])(
    '%s, in every tier-consistent context, model output, and profile',
    (name) => {
      const edge = EDGE_CAPTURES.find(([edgeName]) => edgeName === name);
      for (const { name: contextName, context } of TAG_CONTEXTS) {
        const analysis = edge ? analyzeReading(edge[1](), context) : batteryAnalysis(name, contextName);
        for (const rhythm of rhythmVariants(rhythmModelRows(analysis).length))
          for (const diabetes of [null, BATTERY_DIABETES])
            for (const { profile } of BATTERY_PROFILES)
              for (const history of [[], BATTERY_HISTORY]) {
                const built = buildReadingResult(
                  analysis,
                  { rhythm, diabetes },
                  PASSED_EVIDENCE,
                  profile,
                  history,
                );
                expectHonestTags(built, context);
                expectRhythmJudgedFromEnoughIntervals(built, analysis);
              }
      }
    },
    120_000,
  );

  // Found at 3ad37eb: when DSP-13's three estimates all exist but disagree, breathing shows the interval estimate
  // tagged fewWindows {windows: 3, wantWindows: 3}: "3 of 3" is no shortfall, so the "more info" text has
  // nothing true to say. A premature beat every 8th beat at 75 bpm, 95 s at 60 fps, Full Scan, Full tier.
  test('breathing whose three estimates disagree names a reason it actually missed', () => {
    const analysis = batteryAnalysis(
      'premature beat every 8th at 75 bpm, 95 s at 60 fps',
      'Full Scan, Full tier, 60 fps, SQI',
    );
    expect(analysis.breathing?.rateBrpm).toBeNull();
    const built = batteryResult(analysis, 1, profileNamed('no flags'));
    expect(built.metrics.resp?.quality).toBe('low');
    const reason = built.quality.reasons.find((entry) => entry.kind === 'fewWindows');
    if (reason?.kind === 'fewWindows') expect(reason.windows).toBeLessThan(reason.wantWindows);
  });

  // Found at 3ad37eb: §5.2 tiers also weigh the score and ambient light, so a 60 fps phone can be rated Basic.
  // RMSSD and the diabetes pattern then carry lowFps {fps: 60, wantFps: 60}, blaming a frame rate that met
  // the floor. 95 s of sinus at 75 bpm, Full Scan, Basic tier, captureFps 60.
  test('a 60 fps phone rated Basic is not told its frame rate was too low', () => {
    const analysis = analyzeReading(BATTERY_CAPTURES[0]!.build(), {
      ...BATTERY_CONTEXTS[0]!.context,
      tier: 'basic',
    });
    const built = batteryResult(analysis, 1, profileNamed('no flags'));
    for (const reason of built.quality.reasons)
      if (reason.kind === 'lowFps') expect(reason.fps).toBeLessThan(reason.wantFps);
  });

  // Found at 3ad37eb: a capture format with no finite rate (the red-team inputs NaN and ±Infinity, which DSP-12
  // and DSP-14 already refuse) is copied into lowFps.fps, so the Results JSON holds NaN/Infinity, which
  // JSON.stringify saves as null. 20 s at 75 bpm, Quick Check, Basic tier.
  test.each([NaN, Infinity, -Infinity])(
    'captureFps %s puts no non-finite number in the Results JSON',
    (captureFps) => {
      const analysis = analyzeReading(captureAt(regularOffsets(30, 20), pulse(75, 20)), {
        ...BATTERY_CONTEXTS[2]!.context,
        mode: 'quick',
        captureFps,
      });
      const built = batteryResult(analysis, 1, profileNamed('no flags'));
      expect(nonFinitePaths(built)).toEqual([]);
    },
  );
});

describe('red team ADR 0104 SAFE-1: the emergency rules never read the lower-quality path', () => {
  // emergencyHeartRate and readingOutcome.urgent must not move when only the lower-quality values change, at
  // either extreme (a relaxed 220 bpm or 30 bpm next to the standard analysis).
  it.each(BATTERY_CAPTURES.map(({ name }) => name))(
    '%s',
    (name) => {
      for (const { name: contextName } of BATTERY_CONTEXTS) {
        const analysis = batteryAnalysis(name, contextName);
        const urgent = emergencyHeartRate(analysis);
        expect(readingOutcome(analysis).urgent).toEqual(urgent);
        for (const relaxedBpm of [220, 30, null]) {
          const changed: ReadingAnalysis = {
            ...analysis,
            lowQuality: { ...analysis.lowQuality, heartRateBpm: relaxedBpm },
          };
          expect(emergencyHeartRate(changed)).toEqual(urgent);
          expect(readingOutcome(changed).urgent).toEqual(urgent);
        }
      }
    },
    60_000,
  );

  // OWNER DECISION, answered 2026-10-06 (ADR 0104 answer 2). Under 15 clean s there is no standard rate, so
  // SAFE-1 cannot fire and no HR flag fires (a lower-quality rate has low confidence). The reading shows the rate
  // tagged, with a "retake now" prompt instead of the Emergency screen.
  it.each([
    [35, 12, 'shortSlow'],
    [190, 12, 'shortFast'],
  ] as const)(
    'OWNER DECISION: %i bpm for %i s shows that rate tagged with the %s retake prompt, no urgent screen',
    (bpm, seconds, prompt) => {
      const analysis = analyzeReading(captureAt(regularOffsets(30, seconds), pulse(bpm, seconds)), {
        ...BATTERY_CONTEXTS[2]!.context,
        mode: 'quick',
      });
      expect(analysis.heartRateBpm).toBeNull();
      expect(Math.abs(analysis.lowQuality.heartRateBpm! - bpm)).toBeLessThan(1);
      const outcome = readingOutcome(analysis);
      expect(outcome).toEqual({ kind: 'reading', urgent: null });
      const built = batteryResult(analysis, 1, profileNamed('no flags'));
      expect(built.metrics.hr!).toMatchObject({ quality: 'low', flag: null });
      expect(built.retakePrompt).toBe(prompt);
    },
  );

  // The prompt reads only the lower-quality rate: a standard rate never has one, whatever SAFE-1 says.
  it.each(BATTERY_CAPTURES.map(({ name }) => name))(
    '%s: a retake prompt only on a lower-quality rate under 40 or over 150 bpm',
    (name) => {
      for (const { name: contextName } of BATTERY_CONTEXTS) {
        const analysis = batteryAnalysis(name, contextName);
        const hr = batteryResult(analysis, 1, profileNamed('no flags'));
        const metric = hr.metrics.hr;
        const extreme =
          metric !== null && analysis.heartRateBpm === null && (metric.value < 40 || metric.value > 150);
        expect(hr.retakePrompt !== null).toBe(extreme);
      }
    },
    60_000,
  );
});

describe('red team ADR 0104 ML-6 and rhythm claims on lower-quality readings', () => {
  // OWNER DECISION, answered 2026-10-06 (ADR 0104 answer 3: keep). The diabetes pattern's own floors are met, so
  // it flags, while another card (here RMSSD without a rhythm model, tagged rhythmUnjudged) makes the reading
  // "Lower-quality". 95 s of sinus at 75 bpm, Full Scan, Full tier, 60 fps, no rhythm model.
  it('OWNER DECISION: a reading tagged lower quality can still carry a standard diabetes flag', () => {
    const analysis = batteryAnalysis('sinus 75 bpm, 95 s at 60 fps', 'Full Scan, Full tier, 60 fps, SQI');
    const built = buildReadingResult(
      analysis,
      { rhythm: null, diabetes: BATTERY_DIABETES },
      PASSED_EVIDENCE,
      profileNamed('no flags'),
      BATTERY_HISTORY,
    );
    expect(built.quality.level).toBe('low');
    expect(built.metrics.rmssd?.qualityReasons).toEqual(['rhythmUnjudged']);
    expect(built.metrics.diabetes).toMatchObject({ quality: 'standard', flag: 'pattern' });
  });

  // OWNER DECISION, answered 2026-10-06 (ADR 0104 answer 5). A Full Scan with 10 s of beats gets one reading-wide
  // rhythm row of about 12 intervals. At 3ad37eb a sinus row headlined "Regular rhythm", and the shipped
  // rhythm-lgbm calls 3–6 AF intervals sinus in 6–12% of windows (ml/tests/redteam/test_redteam_lower_quality.py).
  // Under 20 intervals the card now reads "too short to judge": no class, no flag, and the headline is the rate,
  // so isRegularFullCheck (mode full and headline result.regular) cannot clear a held flag.
  it.each([[[0.9, 0.05, 0.05]], [[0.05, 0.9, 0.05]]] as const)(
    'OWNER DECISION: 10 s of beats on a Full Scan is too short to judge the rhythm (%j)',
    (probs) => {
      const analysis = analyzeReading(
        captureAt(regularOffsets(60, 10), pulse(75, 10)),
        BATTERY_CONTEXTS[0]!.context,
      );
      expect(analysis.rhythmFeatures).toEqual([]);
      expect(rhythmModelRows(analysis)).toHaveLength(1);
      const built = buildReadingResult(
        analysis,
        { rhythm: { windowProbs: [[...probs]], tauAf: 0.25 }, diabetes: null },
        PASSED_EVIDENCE,
        profileNamed('no flags'),
        [],
      );
      expect(built.headlineKey).toBe('result.hrOnly');
      expect(built.metrics.rhythm).toMatchObject({ class: null, pAF: null, flag: null, quality: 'low' });
      expect(built.quality.level).toBe('low');
    },
  );
});

// The app's loop as reading-outcome-harmonics: SQI 0.9 on every window, batches of 3 frames, then the saved
// analysis (Quick, Basic tier, 30 fps, no SQI-Net spans of its own).
const STILL: CaptureStatus = {
  fingerCovered: true,
  motionRms: 0,
  thermal: 'nominal',
  fps: 30,
  droppedFrac: 0,
};
const CLOCK_START_NS = 5_000_000_000_000;
const toNsGrid = (tS: number) => Math.round(tS * 1e9) / 1e9;
function framesAt(offsetsS: number[], channels: Channels) {
  const samples: Sample[] = [];
  const stats: FrameStat[] = [];
  for (const tS of offsetsS) {
    const offsetNs = Math.round(tS * 1e9);
    samples.push({ tNs: CLOCK_START_NS + offsetNs, ...channels(offsetNs / 1e9) });
    stats.push({ tNs: CLOCK_START_NS + offsetNs, spatialStdR: 0.02, clipFrac: 0, exposureNs: 8_000_000 });
  }
  return { samples, stats };
}
const LIVE_CONTEXT: ReadingContext = {
  ...BATTERY_CONTEXTS[2]!.context,
  mode: 'quick',
  recordedAt: null,
  sqi: null,
};
function liveReplay(offsetsS: number[], channels: Channels): ReadingAnalysis {
  const frames = framesAt(offsetsS, channels);
  const session = createLiveSession({
    captureFps: 30,
    sqiThreshold: 0.5,
    perfusionFloorPct: DSP_CONFIG.live.defaultPerfusionFloorPct,
  });
  let scoredEndS: number | null = null;
  for (let start = 0; start < frames.samples.length; start += 3) {
    session.pushSamples({
      samples: frames.samples.slice(start, start + 3),
      stats: frames.stats.slice(start, start + 3),
    });
    session.pushStatus(STILL);
    const window = session.sqiWindow;
    if (window && window.endS !== scoredEndS) {
      scoredEndS = window.endS;
      session.setSqi(window.endS, 0.9);
    }
  }
  const { capture: saved, ...spans } = session.readingInput();
  const analysis = analyzeReading(saved, { ...LIVE_CONTEXT, ...spans });
  const lastS = (saved.samples.at(-1)!.tNs - saved.samples[0]!.tNs) / 1e9;
  expect(cleanSeconds(0, lastS, session.rejectedSpans)).toBeCloseTo(analysis.cleanSeconds, 9);
  return analysis;
}

// Clusters of 1 + copies frames 1 ms apart; gapsMs, cycled, from a cluster's last frame to the next one's first.
function clusters(totalS: number, gapsMs: number[], copies: number): number[] {
  const offsetsS: number[] = [];
  for (let tS = 0, k = 0; tS <= totalS; k++) {
    for (let c = 0; c <= copies; c++) offsetsS.push(toNsGrid(tS + c / 1000));
    tS += (copies + gapsMs[k % gapsMs.length]!) / 1000;
  }
  return offsetsS.filter((tS) => tS <= totalS);
}
const oneLongPerSpan = (longMs: number, shortMs: number) => [
  longMs,
  ...Array<number>(Math.floor((1000 - 2 * longMs) / shortMs) + 1).fill(shortMs),
];
// Every 4 s: burstS of fastFps frames, then frames slowStepS apart (reading-outcome-floor's padded window).
function bursts(fastFps: number, burstS: number, slowStepS: number, untilS: number): number[] {
  const offsets: number[] = [];
  for (let fromS = 0; fromS < untilS; fromS += 4) {
    for (let k = 0; k <= Math.floor(burstS * fastFps + 1e-9); k++)
      offsets.push(Math.round(fromS * 1e9 + (k * 1e9) / fastFps) / 1e9);
    for (let tS = fromS + burstS + slowStepS; tS < fromS + 4 - 1e-9; tS += slowStepS)
      offsets.push(toNsGrid(tS));
  }
  return offsets;
}
const steadyPulse = (bpm: number): Channels => beatTrain(beatTimes([60 / bpm], 800), 0.3);
// A sinusoidal pulse with a second harmonic, as reading-outcome-harmonics.
function harmonicPulse(bpm: number, second: number): Channels {
  return (tS) => {
    const phase = (2 * Math.PI * bpm * tS) / 60;
    return { r: 0.6 - 0.006 * (Math.sin(phase) + second * Math.sin(2 * phase + 0.7)), g: 0.1, b: 0.05 };
  };
}

describe('red team ADR 0104: the lower-quality rate is within 5 bpm on the aliasing captures', () => {
  // 3ad37eb changed the earlier suites' expectAccurateOrRefused to accept any lower-quality rate without checking
  // it. These hold it to ANSI/AAMI EC13's 5 bpm again (refusing is still allowed). The controls, beatTrain on the
  // same frame times, read within 2.8 bpm at 3ad37eb.
  it.each([
    ['even 120 ms + 2 copies', 200, () => clusters(40, [118], 2)],
    ['even 120 ms + 2 copies', 220, () => clusters(40, [118], 2)],
    ['one 150 ms + 119 ms, 3 copies', 220, () => clusters(40, oneLongPerSpan(150, 119), 3)],
    ['one 150 ms + 110 ms, 3 copies', 210, () => clusters(40, oneLongPerSpan(150, 110), 3)],
  ])(
    'control: %s, beatTrain %i bpm: within 5 bpm or refused',
    (_, bpm, offsets) => {
      const analysis = liveReplay(offsets(), steadyPulse(bpm));
      expect(analysis.heartRateBpm).toBeNull();
      const lowBpm = analysis.lowQuality.heartRateBpm;
      if (lowBpm !== null) expect(Math.abs(lowBpm - bpm)).toBeLessThanOrEqual(5);
    },
    60_000,
  );

  // Found at 3ad37eb (ADR 0104 Consequences lists the same three): read 212.90, 197.80, and 234.87 bpm, from
  // under 1 clean second each. Pulses as reading-outcome-harmonics (sinusoid with a 0.5 second harmonic) and
  // reading-outcome-floor (beatTrain).
  test.failing.each([
    [
      'one 150 ms + 119 ms, 3 copies, live replay, harmonics 0.5 / 0',
      220,
      () => liveReplay(clusters(40, oneLongPerSpan(150, 119), 3), harmonicPulse(220, 0.5)),
    ],
    [
      'one 150 ms + 110 ms, 3 copies, live replay, harmonics 0.5 / 0',
      210,
      () => liveReplay(clusters(40, oneLongPerSpan(150, 110), 3), harmonicPulse(210, 0.5)),
    ],
    [
      '120 fps bursts of 0.6 s then frames 0.125 s apart for 120 s, beatTrain, saved analysis',
      220,
      () =>
        analyzeReading(framesAt(bursts(120, 0.6, 0.125, 120), steadyPulse(220)), {
          ...LIVE_CONTEXT,
          captureFps: 120,
        }),
    ],
  ])(
    '%s, %i bpm: the lower-quality rate is within 5 bpm',
    (_, bpm, analyse) => {
      const analysis = analyse();
      expect(analysis.heartRateBpm).toBeNull();
      expect(Math.abs(analysis.lowQuality.heartRateBpm! - bpm)).toBeLessThanOrEqual(5);
    },
    60_000,
  );
});

// The live graph's input as display-pulse.test.ts builds it: a two-wave pulse through the session's causal
// band-pass, the last 6 s shown. heights[k] scales beat k (a premature beat ejects less).
function liveTrace(intervalsS: number[], heights: number[], fps: number) {
  const gaussian = (tS: number, centreS: number, sigmaS: number) =>
    Math.exp(-0.5 * ((tS - centreS) / sigmaS) ** 2);
  const peaksS: number[] = [];
  const peakHeights: number[] = [];
  for (let tS = 0.3, k = 0; tS < 21; tS += intervalsS[k % intervalsS.length]!, k++) {
    peaksS.push(tS);
    peakHeights.push(heights[k % heights.length]!);
  }
  const raw = Array.from({ length: 20 * fps }, (_, k) =>
    peaksS.reduce(
      (sum, peakS, i) =>
        sum + peakHeights[i]! * (gaussian(k / fps, peakS, 0.06) + 0.4 * gaussian(k / fps, peakS + 0.3, 0.08)),
      0,
    ),
  );
  const [lowHz, highHz] = DSP_CONFIG.dsp6.morphologyBandHz as [number, number];
  const filtered = new CausalFilter(
    butterBandpass(DSP_CONFIG.dsp6.morphologyOrder, lowHz, highHz, fps),
  ).filter(raw);
  const first = 14 * fps;
  const tS = Array.from({ length: 6 * fps }, (_, k) => (first + k) / fps);
  const liveBpm = (60 * (peaksS.length - 1)) / (peaksS.at(-1)! - peaksS[0]!);
  return { tS, ppg: Array.from(filtered.slice(first)), peaksS, liveBpm };
}
// Bumps and beats away from the zero-phase edges.
function bumpsAndBeats(intervalsS: number[], heights: number[], fps: number) {
  const { tS, ppg, peaksS, liveBpm } = liveTrace(intervalsS, heights, fps);
  const shown = displayPulse(tS, ppg, liveBpm);
  const inner = (t: number) => t - tS[0]! > 0.8 && tS.at(-1)! - t > 0.8;
  let bumps = 0;
  for (let i = 1; i < shown.length - 1; i++)
    if (shown[i]! > shown[i - 1]! && shown[i]! >= shown[i + 1]! && inner(tS[i]!)) bumps++;
  return { bumps, beats: peaksS.filter(inner).length };
}

describe('red team 5f7730d: displayPulse shows one bump per beat', () => {
  it.each([60, 75, 90, 110])('control: regular %i bpm at 30 fps', (bpm) => {
    const { bumps, beats } = bumpsAndBeats([60 / bpm], [1], 30);
    expect(bumps).toBe(beats);
  });

  // Found at 5f7730d (display only, never analysis): with every other beat premature and smaller (bigeminy), or
  // every other beat weaker at an even rate (pulsus alternans), the trace repeats better after two beats than
  // after one, so fundamentalHz halves the beat rate and the low-pass removes every other beat. At 30 fps the
  // graph shows 2 bumps for 5 beats (PVC bigeminy, 75 bpm), 3 for 7 (PAC bigeminy, 75 bpm), and 4 for 7 or 8
  // (alternans 1 / 0.6, 90 and 110 bpm). intervals × 60 / bpm; heights per beat.
  test.each([
    ['PVC bigeminy 0.62 / 1.38', 75, [0.62, 1.38], [1, 0.6]],
    ['PAC bigeminy 0.7 / 1.05', 75, [0.7, 1.05], [1, 0.7]],
    ['pulsus alternans 1 / 1', 90, [1, 1], [1, 0.6]],
    ['pulsus alternans 1 / 1', 110, [1, 1], [1, 0.6]],
  ])('%s at %i bpm, 30 fps: one bump per beat', (_, bpm, pattern, heights) => {
    const { bumps, beats } = bumpsAndBeats(
      pattern.map((ratio) => (ratio * 60) / bpm),
      heights,
      30,
    );
    expect(bumps).toBe(beats);
  });

  // Fixed by a 1.4 × cutoff with no halving: no beat is lost. The long beat's dicrotic wave shows once in the
  // window, one bump too many; a fixed cutoff that removes it (1.2 ×) loses the premature beat at 75 bpm.
  it('PVC bigeminy 0.62 / 1.38 at 110 bpm, 30 fps: no beat lost, at most one extra bump', () => {
    const { bumps, beats } = bumpsAndBeats(
      [0.62, 1.38].map((ratio) => (ratio * 60) / 110),
      [1, 0.6],
      30,
    );
    expect(bumps).toBeGreaterThanOrEqual(beats);
    expect(bumps).toBeLessThanOrEqual(beats + 1);
  });
});
