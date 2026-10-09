export type Range = { low: number; high: number };
type PathPoint = { x: number; y: number; bridge?: boolean };

// A smooth SVG path through `points` (Catmull-Rom turned into cubic Beziers), so a beat reads as a curve and not a
// run of straight segments. Control points stay inside [0, maxY] so a steep beat cannot overshoot the card. A point
// marked `bridge` is joined to the one before it by a straight line, and the curve does not lean across it.
export function smoothPath(points: readonly PathPoint[], maxY: number): string {
  'worklet';
  const first = points[0];
  if (!first) return '';
  const clamp = (y: number) => Math.min(maxY, Math.max(0, y));
  let path = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (to.bridge) {
      path += `L${to.x.toFixed(1)},${to.y.toFixed(1)}`;
      continue;
    }
    const before = from.bridge ? from : points[Math.max(0, index - 1)]!;
    const ahead = points[Math.min(points.length - 1, index + 2)]!;
    const after = ahead.bridge ? to : ahead;
    const controlAx = from.x + (to.x - before.x) / 6;
    const controlAy = clamp(from.y + (to.y - before.y) / 6);
    const controlBx = to.x - (after.x - from.x) / 6;
    const controlBy = clamp(to.y - (after.y - from.y) / 6);
    path += `C${controlAx.toFixed(1)},${controlAy.toFixed(1)} ${controlBx.toFixed(1)},${controlBy.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)}`;
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
  'worklet';
  if (!target) return current;
  if (!current) return target;
  const share = 1 - Math.exp(-Math.max(0, elapsedMs) / settleMs);
  return {
    low: current.low + (target.low - current.low) * share,
    high: current.high + (target.high - current.high) * share,
  };
}
