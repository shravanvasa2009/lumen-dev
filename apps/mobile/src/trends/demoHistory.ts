import { readingById, type FixtureReading } from '@/results/fixtures';

import type { HistoryReading } from './series';

// Hand-written sample history (§8.5): 24 mornings from Aug 29 to Sep 27, 2026, not recorded from anyone.
// The last row is the `demo` fixture's own reading, so its Results screen opens from Trends; the two other
// fixtures of that day follow it, so Trends and the Doctor report list the same day. Months are
// zero-based. Full Scans carry HRV and breathing; Quick Checks do not.
type Row = readonly [
  month: number,
  day: number,
  hr: number,
  rmssd: number | null,
  resp: number | null,
  caffeine: boolean,
];

const rows: readonly Row[] = [
  [7, 29, 61, null, null, false],
  [7, 30, 65, 52, 14, false],
  [8, 1, 62, null, null, false],
  [8, 2, 66, 47, 15, false],
  [8, 3, 65, null, null, false],
  [8, 4, 64, 50, 14, false],
  [8, 5, 67, null, null, false],
  [8, 6, 62, 55, 13, false],
  [8, 8, 64, null, null, false],
  [8, 9, 70, 41, 16, true],
  [8, 10, 64, null, null, false],
  [8, 12, 60, 57, 13, false],
  [8, 13, 65, null, null, false],
  [8, 14, 62, 49, 14, false],
  [8, 16, 62, null, null, false],
  [8, 17, 66, 46, 15, false],
  [8, 19, 69, null, null, true],
  [8, 20, 61, 53, 13, false],
  [8, 21, 60, null, null, false],
  [8, 22, 65, 44, 14, false],
  [8, 24, 64, null, null, false],
  [8, 25, 66, 51, 14, false],
  [8, 26, 71, null, null, true],
  [8, 27, 64, 48, 14, false],
];

const demoReadingRow = rows.length - 1;

const sampleHistory: readonly HistoryReading[] = rows.map(
  ([month, day, hr, rmssd, resp, caffeine], index) => ({
    id: index === demoReadingRow ? 'demo' : `history-${index + 1}`,
    createdAt: new Date(2026, month, day, 7, index === demoReadingRow ? 42 : 30 + (index % 9)),
    mode: rmssd === null ? 'quick' : 'full',
    hr,
    rmssd,
    resp,
    rhythm: 'sinus',
    flaggedLowRhythm: null,
    caffeine,
    intervalsMs: index === demoReadingRow ? (readingById('demo')?.intervalsMs ?? []) : [],
  }),
);

function fromFixture({ id, createdAt, mode, scan, intervalsMs }: FixtureReading): HistoryReading {
  const { hr, rmssd, resp, rhythm } = scan.metrics;
  return {
    id,
    createdAt,
    mode,
    hr: hr?.value ?? null,
    rmssd: rmssd?.value ?? null,
    resp: resp?.value ?? null,
    rhythm: rhythm?.class ?? null,
    flaggedLowRhythm: null,
    caffeine: false,
    intervalsMs,
  };
}

const sameDayFixtures = ['demo-inconclusive', 'demo-flag'].flatMap((id) => {
  const fixture = readingById(id);
  return fixture ? [fromFixture(fixture)] : [];
});

export const demoHistory: readonly HistoryReading[] = [...sampleHistory, ...sameDayFixtures];

// The range buttons count back from the last sample reading, whatever the real date is.
export const demoNow = new Date(2026, 8, 27, 20, 0);
