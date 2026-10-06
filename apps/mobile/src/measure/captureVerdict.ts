import type { CoachingKey, RejectedSpan } from '@lumen/core';

import type { LiveCapture } from './useLiveCapture';

// The Weak to Strong level never reads above OK while the clean-seconds count is stopped.
const OK_CEILING = 0.5;
// A rejected span still counts as "now" when it ends within this many seconds of the newest frame; the session's
// clock starts a little after the screen's.
const NOW_TOLERANCE_S = 2;

const COACHING_FOR: Partial<Record<RejectedSpan['reason'], CoachingKey>> = {
  coverage: 'coach.cover',
  clipping: 'coach.lighter',
  pressure: 'coach.lighter',
  motion: 'coach.still',
  coldHands: 'coach.warm',
};

export type CaptureVerdict = {
  // The level for the quality chip and the practice meter; null while there is none.
  level: number | null;
  // Why the count is stopped, in the existing coaching words; null while it counts or the cause has no coaching line.
  coaching: CoachingKey | null;
};

// What the screen may claim. The session's coaching line is debounced and exposure or quality rejections have
// none, so a count that has stopped can look fine on the level alone; here the count decides, and the reason comes
// from the session's coaching line or else from the rejection that is open now.
export function captureVerdict(live: LiveCapture): CaptureVerdict {
  if (live.phase !== 'running') return { level: null, coaching: null };
  const level = live.signalLevel;
  if (live.advancing) return { level, coaching: live.coachingKey };
  const open = live.rejectedSpans
    .filter((span) => span.endS >= live.elapsedS - NOW_TOLERANCE_S)
    .reduce<RejectedSpan | null>((latest, span) => (latest && latest.endS >= span.endS ? latest : span), null);
  const fromSpan = open ? (COACHING_FOR[open.reason] ?? null) : null;
  return { level: level === null ? null : Math.min(level, OK_CEILING), coaching: live.coachingKey ?? fromSpan };
}
