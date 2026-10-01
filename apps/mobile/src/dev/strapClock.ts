// Strap RR rows must be on the camera's tNs clock (order E.B polar-clock), but BLE notifications arrive in
// JS, which only has performance.now(). Both arrive in JS, so JS time minus the newest sample's tNs, at the
// moment a sample batch arrives, is the clock difference plus that batch's bridge delay. The smallest
// value over the capture has the least delay. The leftover delay (tens of ms) is absorbed by eval:replay's
// beat-sequence alignment.
export const jsClockNs = () => performance.now() * 1e6;

export function lowerOffsetNs(current: number | null, jsNs: number, newestSampleTNs: number): number {
  const offset = jsNs - newestSampleTNs;
  return current === null ? offset : Math.min(current, offset);
}

export interface StrapNotification {
  jsNs: number;
  rrMs: number[];
}

// Appendix B polarRr. One notification can carry several RR intervals, oldest first; the newest ends at the
// beat just before the notification, so each earlier one ends that much sooner by the RR after it.
export function stampStrapRr(
  notifications: readonly StrapNotification[],
  offsetNs: number | null,
): { tNs: number[]; rrMs: number[] } | undefined {
  if (offsetNs === null) return undefined;
  const tNs: number[] = [];
  const rrMs: number[] = [];
  for (const { jsNs, rrMs: intervals } of notifications) {
    let endNs = jsNs - offsetNs;
    const stamped: number[] = [];
    for (let i = intervals.length - 1; i >= 0; i--) {
      stamped.unshift(Math.round(endNs));
      endNs -= intervals[i]! * 1e6;
    }
    tNs.push(...stamped);
    rrMs.push(...intervals);
  }
  return rrMs.length ? { tNs, rrMs } : undefined;
}
