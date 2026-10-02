// Strap RR rows must be on the camera's tNs clock (order E.B polar-clock), but BLE notifications arrive in
// JS, which only has performance.now(). Both arrive in JS, so JS time minus the newest sample's tNs, at the
// moment a sample batch arrives, is the clock difference plus that batch's bridge delay. The smallest
// value over the capture has the least delay.
export const jsClockNs = () => performance.now() * 1e6;

export function lowerOffsetNs(current: number | null, jsNs: number, newestSampleTNs: number): number {
  const offset = jsNs - newestSampleTNs;
  return current === null ? offset : Math.min(current, offset);
}

export interface StrapNotification {
  jsNs: number;
  rrMs: number[];
}

interface Stretch {
  // Camera tNs at which the stretch's first RR interval began.
  startNs: number;
  // Each beat's end, measured from startNs.
  beatEndsNs: number[];
}

function runningEndsNs(fromNs: number, rrMs: readonly number[]): number[] {
  let endNs = fromNs;
  return rrMs.map((intervalMs) => (endNs += intervalMs * 1e6));
}

// Appendix B polarRr. The strap notifies about once a second, not once per beat, so a notification's newest
// beat ended anywhere from 0 to one RR before it arrived. Stamping each notification at its arrival would
// put up to one RR of jitter between rows, which eval:replay reads as lost beats (ADR 0037). Instead the rows
// form one beat timeline, each beat ending its own RR after the one before. Each arrival comes after its
// newest beat, so arrival minus the timeline's elapsed time is the timeline's start plus that notification's
// delay; the smallest over the stretch is the tightest bound and anchors it. A notification goes out before
// the beat after its newest one, so an arrival later than the anchor by more than that following RR means
// beats were lost: a new stretch starts there with its own anchor.
// Limits: transport delay is not part of that bound, so an unusually slow arrival just before a beat can
// restart the timeline without a loss; the new anchor is then off by about the delay difference. A lost beat
// just after a stretch starts can go unproven, since one late arrival looks the same until a low-delay
// arrival tightens the anchor.
// All notifications are known when this runs (at Stop), so every row uses its stretch's final anchor.
export function stampStrapRr(
  notifications: readonly StrapNotification[],
  offsetNs: number | null,
): { tNs: number[]; rrMs: number[] } | undefined {
  if (offsetNs === null) return undefined;
  const stretches: Stretch[] = [];
  const rrMs: number[] = [];
  const withRr = notifications.filter(({ rrMs: intervals }) => intervals.length);
  withRr.forEach(({ jsNs, rrMs: intervals }, i) => {
    const arrivalNs = jsNs - offsetNs;
    const nextRrNs = (withRr[i + 1]?.rrMs[0] ?? intervals[intervals.length - 1]!) * 1e6;
    const stretch = stretches[stretches.length - 1];
    const elapsedNs = stretch ? stretch.beatEndsNs[stretch.beatEndsNs.length - 1]! : 0;
    const beatEndsNs = runningEndsNs(elapsedNs, intervals);
    const startNs = arrivalNs - beatEndsNs[beatEndsNs.length - 1]!;
    if (stretch && startNs - stretch.startNs <= nextRrNs) {
      stretch.startNs = Math.min(stretch.startNs, startNs);
      stretch.beatEndsNs.push(...beatEndsNs);
    } else {
      const ownEndsNs = runningEndsNs(0, intervals);
      stretches.push({ startNs: arrivalNs - ownEndsNs[ownEndsNs.length - 1]!, beatEndsNs: ownEndsNs });
    }
    rrMs.push(...intervals);
  });
  const tNs = stretches.flatMap(({ startNs, beatEndsNs }) =>
    beatEndsNs.map((endNs) => Math.round(startNs + endNs)),
  );
  return rrMs.length ? { tNs, rrMs } : undefined;
}
