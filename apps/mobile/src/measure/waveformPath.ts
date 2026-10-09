export type Range = { low: number; high: number };

// A smooth SVG path through `points` (Catmull-Rom turned into cubic Beziers), so a beat reads as a curve and not a
// run of straight segments. Control points stay inside [0, maxY] so a steep beat cannot overshoot the card.
export function smoothPath(points: readonly { x: number; y: number }[], maxY: number): string {
  const first = points[0];
  if (!first) return '';
  const clamp = (y: number) => Math.min(maxY, Math.max(0, y));
  let path = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[Math.max(0, index - 1)]!;
    const from = points[index]!;
    const to = points[index + 1]!;
    const after = points[Math.min(points.length - 1, index + 2)]!;
    const controlA = { x: from.x + (to.x - before.x) / 6, y: clamp(from.y + (to.y - before.y) / 6) };
    const controlB = { x: to.x - (after.x - from.x) / 6, y: clamp(to.y - (after.y - from.y) / 6) };
    path += `C${controlA.x.toFixed(1)},${controlA.y.toFixed(1)} ${controlB.x.toFixed(1)},${controlB.y.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
  }
  return path;
}

// Moves `current` toward `target` by the share of the gap that `elapsedMs` covers with time constant `settleMs`,
// so the vertical scale glides over about a second instead of jumping with every update. The first range is taken
// as is, and a longer gap between updates never overshoots.
export function easeRange(
  current: Range | null,
  target: Range | null,
  elapsedMs: number,
  settleMs: number,
): Range | null {
  if (!target) return current;
  if (!current) return target;
  const share = 1 - Math.exp(-Math.max(0, elapsedMs) / settleMs);
  return {
    low: current.low + (target.low - current.low) * share,
    high: current.high + (target.high - current.high) * share,
  };
}

// How long the trace slides after a batch. It only slides while the window is full and continuous: the same
// number of samples as the last batch (give or take one) and no long gap. While the window fills, after a finger
// lift empties it, or after a stall, the trace is drawn still because a slide would start from a wrong place.
export function glideDurationMs(
  previousCount: number | null,
  count: number,
  elapsedMs: number,
  maxGlideMs: number,
  reduceMotion: boolean,
): number {
  if (reduceMotion || previousCount === null || Math.abs(count - previousCount) > 1) return 0;
  return elapsedMs > maxGlideMs ? 0 : Math.max(0, elapsedMs);
}
