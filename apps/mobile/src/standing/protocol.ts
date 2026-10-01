// DSP-16 protocol timings. Minute 0 names the lying baseline reading in a ReadingSlot.
const MINUTE_MS = 60_000;
const LYING_MS = 5 * MINUTE_MS;
const BASELINE_STARTS_MS = 4 * MINUTE_MS;
const LAST_STANDING_MINUTE = 10;
const LAST_READING_WINDOW_MS = 45_000;

export const STANDING_READING_MINUTES = [1, 3, 5, LAST_STANDING_MINUTE] as const;

type Stage = 'intro' | 'lying' | 'baseline' | 'standing' | 'done';

const STAGES: readonly Stage[] = ['intro', 'lying', 'baseline', 'standing', 'done'];

export type ReadingSlot = { minute: 0 | (typeof STANDING_READING_MINUTES)[number] };

export type TestState = {
  startedAt: number | null;
  stoppedAt: number | null;
  fainted: boolean;
  baseline: number | null;
  standing: readonly StandingReading[];
};

type StandingReading = { minute: ReadingSlot['minute']; bpm: number | null };

type ChartPoint = { minute: number; bpm: number };

export type TestView = {
  stage: Stage;
  step: number;
  stopped: boolean;
  fainted: boolean;
  lyingRemainingMs: number;
  standingElapsedMs: number;
  nextReadingAtMs: number | null;
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
    fainted: false,
    baseline: null,
    standing: STANDING_READING_MINUTES.map((minute) => ({ minute, bpm: null })),
  };
}

export function begin(state: TestState, nowMs: number): TestState {
  return state.startedAt === null ? { ...state, startedAt: nowMs } : state;
}

export function stop(state: TestState, nowMs: number, fainted: boolean): TestState {
  return state.stoppedAt === null ? { ...state, stoppedAt: nowMs, fainted } : state;
}

export function recordReading(state: TestState, slot: ReadingSlot, bpm: number): TestState {
  if (slot.minute === 0) return { ...state, baseline: bpm };
  return {
    ...state,
    standing: state.standing.map((kept) => (kept.minute === slot.minute ? { ...kept, bpm } : kept)),
  };
}

function stageAt(elapsedMs: number): Stage {
  if (elapsedMs < BASELINE_STARTS_MS) return 'lying';
  if (elapsedMs < LYING_MS) return 'baseline';
  const lastDueMs = LAST_STANDING_MINUTE * MINUTE_MS;
  return elapsedMs - LYING_MS < lastDueMs + LAST_READING_WINDOW_MS ? 'standing' : 'done';
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
  if (live && stage === 'standing') dueSlot = dueStandingSlot(state, standingElapsedMs);

  const nextReading = state.standing.find(
    ({ minute, bpm }) => bpm === null && standingElapsedMs < minute * MINUTE_MS,
  );
  const taken = state.standing.flatMap(({ minute, bpm }) => (bpm === null ? [] : [{ minute, bpm }]));
  const latest = taken.at(-1)?.bpm ?? null;

  return {
    stage,
    step: STAGES.indexOf(stage) + 1,
    stopped: !live,
    fainted: state.fainted,
    lyingRemainingMs: Math.max(0, LYING_MS - elapsedMs),
    standingElapsedMs,
    nextReadingAtMs: stage === 'standing' && nextReading ? nextReading.minute * MINUTE_MS : null,
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
