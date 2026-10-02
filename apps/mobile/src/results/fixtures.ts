import type { ReadingResult } from '@lumen/core';

import type { MeasureMode } from '@/measure/mode';

// Replay and Demo readings (ADR 0046). `scan` follows Appendix B; the other fields are the readings-row
// values the screens need that the core contract does not carry.
export type FixtureReading = {
  id: string;
  mode: MeasureMode;
  createdAt: Date;
  // §8.5: the irregular demo's intervals are hand-written synthetic values, not recorded from a person.
  synthetic: boolean;
  scan: ReadingResult;
  intervalsMs: readonly number[];
  // Set when the rhythm rule asks for repeat readings today (§10.1).
  repeat: { number: number; of: number } | null;
  // Days of the Full Scans behind the diabetes estimate; the core contract keeps only their count.
  diabetesDays: readonly Date[];
};

// 40 beats near 64 bpm with a slow breathing swell, so the plot reads as a tight regular cluster.
export const regularIntervalsMs = [
  930, 945, 962, 951, 938, 921, 915, 929, 947, 960, 955, 940, 926, 918, 924, 939, 953, 961, 949, 934, 922,
  917, 931, 946, 958, 952, 938, 924, 919, 927, 941, 955, 960, 947, 932, 921, 918, 930, 944, 957,
];

// 40 beats with no repeating pattern, like the chart in mockup 18.
const irregularIntervalsMs = [
  750, 755, 670, 720, 765, 985, 975, 700, 750, 930, 620, 700, 845, 700, 580, 1000, 630, 810, 950, 550, 775,
  640, 810, 770, 590, 870, 940, 985, 865, 830, 620, 690, 720, 680, 800, 740, 900, 660, 720, 780,
];

// Fixed moments on one demo day, so a demo reading never passes for one taken today (§8.5). The failed
// scan comes first, the `demo` reading is the morning one, and the irregular Quick Check is at midday.
const demoDay = { year: 2026, month: 8, day: 27 } as const;
const at = (hour: number, minute: number) => new Date(demoDay.year, demoDay.month, demoDay.day, hour, minute);

const demo: FixtureReading = {
  id: 'demo',
  mode: 'full',
  createdAt: at(7, 42),
  synthetic: false,
  scan: {
    headlineKey: 'result.regular',
    cleanSeconds: 92,
    beats: 104,
    rejectedBeats: 6,
    metrics: {
      hr: { value: 64, unit: 'bpm', evidence: 'checked', confidence: 'high', flag: null },
      rhythm: { class: 'sinus', pAF: 0.03, evidence: 'public-data', confidence: 'high', flag: null },
      rmssd: {
        value: 48,
        unit: 'ms',
        band: [41, 55],
        evidence: 'checked',
        confidence: 'moderate',
      },
      resp: { value: 14, unit: 'br/min', evidence: 'checked', confidence: 'moderate' },
      diabetes: {
        probability: 0.62,
        readingsUsed: 2,
        evidence: 'public-data',
        confidence: 'moderate',
        flag: 'pattern',
      },
    },
    experimental: { extraBeatsPerMin: 0.7, longPauses: 0, pulseShape: { available: true } },
    lostSeconds: { motion: 4, pressure: 2, coverage: 0, coldHands: 0 },
    notChecked: ['bp', 'spo2', 'heartAttack'],
  },
  intervalsMs: regularIntervalsMs,
  repeat: null,
  diabetesDays: [new Date(2026, 8, 25), new Date(2026, 8, 27)],
};

const demoFlag: FixtureReading = {
  id: 'demo-flag',
  mode: 'quick',
  createdAt: at(12, 30),
  synthetic: true,
  scan: {
    headlineKey: 'result.irregularRetake',
    cleanSeconds: 58,
    beats: 66,
    rejectedBeats: 4,
    metrics: {
      hr: { value: 88, unit: 'bpm', evidence: 'checked', confidence: 'moderate', flag: null },
      rhythm: { class: 'af', pAF: 0.82, evidence: 'public-data', confidence: 'high', flag: 'irregular' },
      rmssd: null,
      resp: null,
      diabetes: null,
    },
    experimental: { extraBeatsPerMin: 0.7, longPauses: 0, pulseShape: { available: false } },
    lostSeconds: { motion: 2, pressure: 0, coverage: 0, coldHands: 0 },
    notChecked: ['bp', 'spo2', 'heartAttack'],
  },
  intervalsMs: irregularIntervalsMs,
  repeat: { number: 1, of: 3 },
  diabetesDays: [],
};

// 38 clean seconds, with the lost 52 split about 60 / 25 / 15 between movement, pressure and light (mockup 19).
const demoInconclusive: FixtureReading = {
  id: 'demo-inconclusive',
  mode: 'full',
  createdAt: at(6, 58),
  synthetic: false,
  scan: {
    headlineKey: 'result.inconclusive',
    cleanSeconds: 38,
    beats: 0,
    rejectedBeats: 0,
    metrics: { hr: null, rhythm: null, rmssd: null, resp: null, diabetes: null },
    experimental: { extraBeatsPerMin: 0, longPauses: 0, pulseShape: { available: false } },
    lostSeconds: { motion: 31, pressure: 13, coverage: 8, coldHands: 0 },
    notChecked: ['bp', 'spo2', 'heartAttack'],
  },
  intervalsMs: [],
  repeat: null,
  diabetesDays: [],
};

// SAFE-1: a regular Quick Check whose only flag is a fast resting heart rate, so the safety question is
// reachable from the heart-rate path alone. It sits on the day before the demo day, so the report's day
// summary for the demo day is unchanged.
const demoHrFlag: FixtureReading = {
  id: 'demo-hr-flag',
  mode: 'quick',
  createdAt: new Date(demoDay.year, demoDay.month, demoDay.day - 1, 9, 15),
  synthetic: true,
  scan: {
    headlineKey: 'result.regular',
    cleanSeconds: 60,
    beats: 112,
    rejectedBeats: 2,
    metrics: {
      hr: { value: 112, unit: 'bpm', evidence: 'checked', confidence: 'high', flag: 'fastResting' },
      rhythm: { class: 'sinus', pAF: 0.04, evidence: 'public-data', confidence: 'high', flag: null },
      rmssd: null,
      resp: null,
      diabetes: null,
    },
    experimental: { extraBeatsPerMin: 0, longPauses: 0, pulseShape: { available: false } },
    lostSeconds: { motion: 0, pressure: 0, coverage: 0, coldHands: 0 },
    notChecked: ['bp', 'spo2', 'heartAttack'],
  },
  // 64 bpm intervals rescaled to 112 bpm.
  intervalsMs: regularIntervalsMs.map((ms) => Math.round((ms * 64) / 112)),
  repeat: null,
  diabetesDays: [],
};

const fixtures: readonly FixtureReading[] = [demo, demoFlag, demoInconclusive, demoHrFlag];

export function readingById(id: string | undefined): FixtureReading | undefined {
  return fixtures.find((fixture) => fixture.id === id);
}

// The readings taken on the same calendar day, for the day summary on the Doctor report, earliest first.
export function readingsOnDay(day: Date): readonly FixtureReading[] {
  return fixtures
    .filter((fixture) => fixture.createdAt.toDateString() === day.toDateString())
    .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
}
