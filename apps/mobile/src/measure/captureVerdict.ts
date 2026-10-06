import type { CoachingKey, RejectedSpan } from '@lumen/core';

import type { LiveCapture } from './useLiveCapture';

// The Weak to Strong level never reads above OK while the clean-seconds count is stopped.
const OK_CEILING = 0.5;
// A rejected span still counts as "now" when it ends within this many seconds of the newest frame; the session's
// clock starts a little after the screen's.
const NOW_TOLERANCE_S = 2;

// The screen's own lines for a stopped count (owner 2026-10-06: "either tell the user they arent clean seconds or
// let the recording progress"): the camera steering its brightness, and any other stall.
export type CaptureCoaching = CoachingKey | 'coach.brightness' | 'coach.notClean';

const COACHING_FOR: Partial<Record<RejectedSpan['reason'], CaptureCoaching>> = {
  coverage: 'coach.cover',
  clipping: 'coach.lighter',
  pressure: 'coach.lighter',
  motion: 'coach.still',
  coldHands: 'coach.warm',
  // DSP-5 greys the second after each exposure change; the exposure lock's own steering makes them.
  exposure: 'coach.brightness',
};

export type CaptureVerdict = {
  // The level for the quality chip and the practice meter; null while there is none.
  level: number | null;
  // Why the count is stopped; null while it counts.
  coaching: CaptureCoaching | null;
};

// What the screen may claim. The session's coaching line is debounced, so a count that has stopped can look fine on
// the level alone; here the count decides. The reason is the session's coaching line, else the rejection open now,
// else the exposure lock still steering, else the plain "not clean yet": a stopped count is never silent.
export function captureVerdict(live: LiveCapture): CaptureVerdict {
  if (live.phase !== 'running') return { level: null, coaching: null };
  const level = live.signalLevel;
  if (live.advancing) return { level, coaching: live.coachingKey };
  const open = live.rejectedSpans
    .filter((span) => span.endS >= live.elapsedS - NOW_TOLERANCE_S)
    .reduce<RejectedSpan | null>(
      (latest, span) => (latest && latest.endS >= span.endS ? latest : span),
      null,
    );
  const fromSpan = open ? (COACHING_FOR[open.reason] ?? null) : null;
  const fallback = live.adjustingExposure ? 'coach.brightness' : 'coach.notClean';
  return {
    level: level === null ? null : Math.min(level, OK_CEILING),
    coaching: live.coachingKey ?? fromSpan ?? fallback,
  };
}
