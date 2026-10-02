import { lowerOffsetNs, stampStrapRr, type StrapNotification } from './strapClock';

test('keeps the smallest JS-minus-camera offset seen over the sample batches', () => {
  let offset: number | null = null;
  offset = lowerOffsetNs(offset, 5_000_000_000, 1_000_000_000);
  offset = lowerOffsetNs(offset, 5_120_000_000, 1_100_000_000);
  offset = lowerOffsetNs(offset, 5_400_000_000, 1_200_000_000);
  expect(offset).toBe(4_000_000_000);
});

test('puts the newest RR at the notification time and earlier ones back by cumulative RR', () => {
  const stamped = stampStrapRr(
    [
      { jsNs: 10_000_000_000, rrMs: [800] },
      { jsNs: 11_900_000_000, rrMs: [1000, 900] },
    ],
    4_000_000_000,
  );
  expect(stamped).toEqual({
    tNs: [6_000_000_000, 7_000_000_000, 7_900_000_000],
    rrMs: [800, 1000, 900],
  });
});

test('rounds to whole ns, as samples.csv writes t_ns', () => {
  const stamped = stampStrapRr([{ jsNs: 10_000_000_000.4, rrMs: [800.78125, 1000] }], 0);
  expect(stamped?.tNs).toEqual([9_000_000_000, 10_000_000_000]);
});

test('has nothing to send without RR values or without a camera clock offset', () => {
  expect(stampStrapRr([], 0)).toBeUndefined();
  expect(stampStrapRr([{ jsNs: 1, rrMs: [] }], 0)).toBeUndefined();
  expect(stampStrapRr([{ jsNs: 1, rrMs: [800] }], null)).toBeUndefined();
});

// SYNTHETIC: a strap simulated in code, not a recording. Beats follow a repeating RR pattern in whole 1/1024 s
// units, as the H10 reports them; notifications go out every second, out of step with the beats, and each
// arrives after a cycling transport delay whose smallest value is 20 ms.
const FIRST_NOTIFY_NS = 1_370_000_000;
const NOTIFY_EVERY_NS = 1_000_000_000;
const DELAYS_NS = [20e6, 45e6, 30e6, 60e6, 25e6];
const CAPTURE_NS = 90e9;

function syntheticStrap(rrPattern1024: readonly number[], lostNotification?: number) {
  const beatEndsNs: number[] = [];
  const beatRrMs: number[] = [];
  for (let endNs = 0, i = 0; endNs < CAPTURE_NS; i++) {
    const intervalMs = (rrPattern1024[i % rrPattern1024.length]! / 1024) * 1000;
    endNs += intervalMs * 1e6;
    beatEndsNs.push(endNs);
    beatRrMs.push(intervalMs);
  }
  const notifications: StrapNotification[] = [];
  const sentBeats: number[] = [];
  let nextBeat = 0;
  for (let n = 0, sentNs = FIRST_NOTIFY_NS; sentNs < CAPTURE_NS; n++, sentNs += NOTIFY_EVERY_NS) {
    const firstBeat = nextBeat;
    while (nextBeat < beatEndsNs.length && beatEndsNs[nextBeat]! <= sentNs) nextBeat++;
    if (n === lostNotification || nextBeat === firstBeat) continue;
    for (let beat = firstBeat; beat < nextBeat; beat++) sentBeats.push(beat);
    notifications.push({
      jsNs: sentNs + DELAYS_NS[n % DELAYS_NS.length]!,
      rrMs: beatRrMs.slice(firstBeat, nextBeat),
    });
  }
  return { notifications, sentBeats, beatEndsNs };
}

// Rounding t_ns to whole ns moves each step by at most 1 ns.
const NS_ROUNDING = 1;
// The bound on a notification's lateness leaves out transport delay, so a slow arrival can restart the
// timeline, off by at most the spread of the synthetic delays.
const DELAY_SPREAD_NS = 40e6;
// eval:replay treats a step longer than its RR by more than this as lost beats (ADR 0037).
const DROPOUT_NS = 250e6;

function stepExcessesNs(stamped: { tNs: number[]; rrMs: number[] }) {
  return stamped.tNs.slice(1).map((tNs, i) => tNs - stamped.tNs[i]! - stamped.rrMs[i + 1]! * 1e6);
}

// The anchor is the least-delayed arrival, so each row lands after its true beat by at least the smallest
// delay and by less than one RR more than it.
function expectOnTrueBeats(stamped: { tNs: number[]; rrMs: number[] }, strap: ReturnType<typeof syntheticStrap>) {
  stamped.tNs.forEach((tNs, i) => {
    const lateNs = tNs - strap.beatEndsNs[strap.sentBeats[i]!]!;
    expect(lateNs).toBeGreaterThanOrEqual(20e6 - NS_ROUNDING);
    expect(lateNs).toBeLessThan(20e6 + stamped.rrMs[i]! * 1e6);
  });
}

// About 55, 60 and 75 bpm: the resting rates where per-notification stamping made false gaps.
const RESTING_PATTERNS = [
  [1126, 1100, 1152, 1110],
  [1024, 1000, 1060, 1010, 1040],
  [820, 790, 850, 805],
];

test.each(RESTING_PATTERNS)(
  'with 1 Hz notifications out of step with beats, rows step by their RR and never by a false gap (%#)',
  (...rrPattern1024) => {
    const strap = syntheticStrap(rrPattern1024);
    const stamped = stampStrapRr(strap.notifications, 0)!;

    expect(stamped.tNs).toHaveLength(strap.sentBeats.length);
    const excessesNs = stepExcessesNs(stamped);
    for (const excessNs of excessesNs) expect(Math.abs(excessNs)).toBeLessThanOrEqual(DELAY_SPREAD_NS);
    const exactSteps = excessesNs.filter((excessNs) => Math.abs(excessNs) <= NS_ROUNDING).length;
    expect(exactSteps).toBeGreaterThanOrEqual(excessesNs.length - 1);
    expectOnTrueBeats(stamped, strap);
  },
);

test('a lost notification leaves one gap, at the lost beats, and the timeline stays on the true beats', () => {
  const strap = syntheticStrap(RESTING_PATTERNS[0]!, 40);
  const stamped = stampStrapRr(strap.notifications, 0)!;

  const afterLoss = strap.sentBeats.findIndex((beat, i) => i > 0 && beat !== strap.sentBeats[i - 1]! + 1);
  const lostNs =
    strap.beatEndsNs[strap.sentBeats[afterLoss]! - 1]! - strap.beatEndsNs[strap.sentBeats[afterLoss - 1]!]!;
  expect(lostNs).toBeGreaterThan(DROPOUT_NS);
  const excessesNs = stepExcessesNs(stamped);
  excessesNs.forEach((excessNs, i) => {
    if (i + 1 === afterLoss) expect(Math.abs(excessNs - lostNs)).toBeLessThanOrEqual(DELAY_SPREAD_NS);
    else expect(Math.abs(excessNs)).toBeLessThanOrEqual(NS_ROUNDING);
  });
  expectOnTrueBeats(stamped, strap);
});
