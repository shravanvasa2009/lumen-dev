// DSP-16 protocol timings. Minute 0 names the lying baseline reading in a ReadingSlot.
const MINUTE_MS = 60_000;
export const LYING_MS = 5 * MINUTE_MS;
const BASELINE_STARTS_MS = 4 * MINUTE_MS;
const LAST_STANDING_MINUTE = 10;
const LAST_READING_WINDOW_MS = 45_000;

export const STANDING_READING_MINUTES = [1, 3, 5, LAST_STANDING_MINUTE] as const;

type Stage = 'intro' | 'lying' | 'baseline' | 'standing' | 'final' | 'done';

// The intro is the pre-test warning and is not numbered; steps 1 to 5 match mockup 21.
const NUMBERED_STAGES: readonly Stage[] = ['lying', 'baseline', 'standing', 'final', 'done'];

export type ReadingSlot = { minute: 0 | (typeof STANDING_READING_MINUTES)[number] };

export type TestState = {
  startedAt: number | null;
  stoppedAt: number | null;
  baseline: number | null;
  standing: readonly StandingReading[];
};

// atMs is the standing time when the reading arrived, so the chart plots when it was really taken.
type StandingReading = { minute: ReadingSlot['minute']; bpm: number | null; atMs: number | null };

export type ChartPoint = { minute: number; bpm: number };

export type TestView = {
  stage: Stage;
  step: number;
  stopped: boolean;
  lyingRemainingMs: number;
  standingElapsedMs: number;
  nextReadingAtMs: number | null;
  // Time until the next reading opens (baseline or standing), for the live timer; null when none is left.
  nextReadingInMs: number | null;
  dueSlot: ReadingSlot | null;
  baseline: number | null;
  latest: number | null;
  rise: number | null;
  points: readonly ChartPoint[];
};

export function newTest(): TestState {
  return {
    startedAt: null,
    stoppedAt: null,
    baseline: null,
    standing: STANDING_READING_MINUTES.map((minute) => ({ minute, bpm: null, atMs: null })),
  };
}

export function begin(state: TestState, nowMs: number): TestState {
  return state.startedAt === null ? { ...state, startedAt: nowMs } : state;
}

export function stop(state: TestState, nowMs: number): TestState {
  return state.stoppedAt === null ? { ...state, stoppedAt: nowMs } : state;
}

// A reading that arrives after the test stopped is dropped.
export function recordReading(state: TestState, slot: ReadingSlot, bpm: number, nowMs: number): TestState {
  if (state.stoppedAt !== null || state.startedAt === null) return state;
  if (slot.minute === 0) return { ...state, baseline: bpm };
  const atMs = Math.max(0, nowMs - state.startedAt - LYING_MS);
  return {
    ...state,
    standing: state.standing.map((kept) => (kept.minute === slot.minute ? { ...kept, bpm, atMs } : kept)),
  };
}

function stageAt(elapsedMs: number): Stage {
  if (elapsedMs < BASELINE_STARTS_MS) return 'lying';
  if (elapsedMs < LYING_MS) return 'baseline';
  const standingMs = elapsedMs - LYING_MS;
  const lastDueMs = LAST_STANDING_MINUTE * MINUTE_MS;
  if (standingMs < lastDueMs) return 'standing';
  return standingMs < lastDueMs + LAST_READING_WINDOW_MS ? 'final' : 'done';
}

// A standing reading stays available until the next one is due, so a slow tap never loses it.
function dueStandingSlot(state: TestState, standingElapsedMs: number): ReadingSlot | null {
  for (const [index, { minute, bpm }] of state.standing.entries()) {
    const nextMinute = state.standing[index + 1]?.minute;
    const open = standingElapsedMs >= minute * MINUTE_MS;
    const closed = nextMinute !== undefined && standingElapsedMs >= nextMinute * MINUTE_MS;
    if (open && !closed && bpm === null) return { minute };
  }
  return null;
}

export function viewAt(state: TestState, nowMs: number): TestView {
  const clockMs = state.stoppedAt ?? nowMs;
  const elapsedMs = state.startedAt === null ? 0 : Math.max(0, clockMs - state.startedAt);
  const stage: Stage = state.startedAt === null ? 'intro' : stageAt(elapsedMs);
  const standingElapsedMs = Math.max(0, elapsedMs - LYING_MS);
  const live = state.stoppedAt === null;

  let dueSlot: ReadingSlot | null = null;
  if (live && stage === 'baseline' && state.baseline === null) dueSlot = { minute: 0 };
  if (live && (stage === 'standing' || stage === 'final'))
    dueSlot = dueStandingSlot(state, standingElapsedMs);

  const nextReading = state.standing.find(
    ({ minute, bpm }) => bpm === null && standingElapsedMs < minute * MINUTE_MS,
  );
  // Elapsed test times when each reading still to take opens; a missed baseline is already in the past.
  const nextOpensAtMs = [
    ...(state.baseline === null ? [BASELINE_STARTS_MS] : []),
    ...state.standing.filter(({ bpm }) => bpm === null).map(({ minute }) => LYING_MS + minute * MINUTE_MS),
  ].find((opensAtMs) => opensAtMs > elapsedMs);
  const taken = state.standing.flatMap(({ bpm, atMs }) =>
    bpm === null || atMs === null ? [] : [{ minute: atMs / MINUTE_MS, bpm }],
  );
  const latest = taken.at(-1)?.bpm ?? null;

  return {
    stage,
    step: NUMBERED_STAGES.indexOf(stage) + 1,
    stopped: !live,
    lyingRemainingMs: Math.max(0, LYING_MS - elapsedMs),
    standingElapsedMs,
    nextReadingAtMs:
      (stage === 'standing' || stage === 'final') && nextReading ? nextReading.minute * MINUTE_MS : null,
    nextReadingInMs:
      state.startedAt !== null && live && nextOpensAtMs !== undefined ? nextOpensAtMs - elapsedMs : null,
    dueSlot,
    baseline: state.baseline,
    latest,
    rise: latest !== null && state.baseline !== null ? latest - state.baseline : null,
    points: [...(state.baseline === null ? [] : [{ minute: -1, bpm: state.baseline }]), ...taken],
  };
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}
