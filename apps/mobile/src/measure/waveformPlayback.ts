import { smoothPath, type Range } from './waveformPath';

export type Series = { t: number[]; v: number[] };

export type TraceGeometry = {
  width: number;
  height: number;
  dotX: number;
  padding: number;
  windowS: number;
  upIsHigh: boolean;
};

// The trace is drawn this far behind the newest sample, so the data for the moment on screen has always arrived
// even when a batch comes late. Batches land about every 100 ms and the Galaxy A17 showed gaps of up to ~200 ms
// between two of them; 300 ms covers that and is short enough that the pulse still reads as live.
export const PLAYBACK_DELAY_S = 0.3;
// Samples more than this far apart (a finger lift, a stalled camera) are joined by a straight line instead of
// being smoothed through, and the trace holds flat while the screen is inside such a gap. At 22 to 30 fps
// ordinary neighbours are 33 to 45 ms apart.
const GAP_S = 0.3;
// At most one drawn point per this many pixels of width keeps the per-frame path short on a budget phone; a
// 22 to 30 fps trace on a phone-width card is already near that, so ordinary captures are drawn sample for sample.
const MIN_STEP_PX = 2;
// The playhead leans toward the clock-derived position with this time constant, so a corrected clock offset
// changes the scroll speed by a few percent instead of jumping the trace.
const PLAYHEAD_SETTLE_MS = 1000;
// A playhead further than this from where the clock says it should be (a long stall) is reset, not slewed.
const RESYNC_S = 1;
// Clock offsets drift upward slowly: a late batch says little about the true offset, an early one says a lot.
const OFFSET_RISE_SHARE = 0.02;

// Appends the newer window to the stored series; samples the new window covers are replaced by it.
export function mergeSeries(
  stored: Series,
  incoming: Series,
  keepS: number,
): Series {
  'worklet';
  const firstNew = incoming.t[0];
  if (firstNew === undefined || incoming.t.length !== incoming.v.length) return { t: [], v: [] };
  let keepUntil = 0;
  while (keepUntil < stored.t.length && stored.t[keepUntil]! < firstNew) keepUntil += 1;
  const t = [...stored.t.slice(0, keepUntil), ...incoming.t];
  const v = [...stored.v.slice(0, keepUntil), ...incoming.v];
  const newest = t[t.length - 1]!;
  let drop = 0;
  while (drop < t.length && newest - t[drop]! > keepS) drop += 1;
  return { t: t.slice(drop), v: v.slice(drop) };
}

// Moves the capture-clock to screen-clock offset (ms) toward `observed`: down at once, up slowly.
export function smoothClockOffset(current: number | null, observed: number): number {
  'worklet';
  if (current === null || observed <= current) return observed;
  return current + (observed - current) * OFFSET_RISE_SHARE;
}

// The capture-clock second the trace's right edge shows: constant speed, never backward, never past the data.
export function advancePlayhead(
  previous: number | null,
  elapsedMs: number,
  targetS: number,
  newestS: number,
): number {
  'worklet';
  let next = targetS;
  if (previous !== null && Math.abs(targetS - previous) <= RESYNC_S) {
    const advanced = previous + elapsedMs / 1000;
    next = advanced + (targetS - advanced) * (1 - Math.exp(-elapsedMs / PLAYHEAD_SETTLE_MS));
  }
  return Math.min(newestS, Math.max(previous ?? -Infinity, next));
}

// Where the screen clock says the right edge should be, in capture-clock seconds.
export function playheadTargetS(frameMs: number, offsetMs: number): number {
  'worklet';
  return (frameMs - offsetMs) / 1000 - PLAYBACK_DELAY_S;
}

// The SVG path of the `windowS` seconds ending at `endS`, and the y of its newest point. Points are placed by their
// own timestamps, so the trace moves by elapsed time only; every `stride`-th sample by absolute index is used, so
// the chosen samples stay the same as the window slides.
export function tracePath(
  series: Series,
  endS: number,
  range: Range,
  geometry: TraceGeometry,
): { d: string; dotY: number } | null {
  'worklet';
  const { t, v } = series;
  const { dotX, height, padding, windowS, upIsHigh } = geometry;
  let last = t.length - 1;
  while (last >= 0 && t[last]! > endS) last -= 1;
  if (last < 0) return null;
  let first = last;
  while (first > 0 && t[first]! >= endS - windowS) first -= 1;
  const span = range.high - range.low;
  const pxPerS = dotX / windowS;
  const yOf = (value: number) => {
    const unit = span > 0 ? Math.min(1, Math.max(0, (value - range.low) / span)) : 0.5;
    return padding + (upIsHigh ? 1 - unit : unit) * (height - 2 * padding);
  };
  const stride = Math.max(1, Math.ceil((last - first + 1) / Math.max(2, Math.floor(dotX / MIN_STEP_PX))));
  const points: { x: number; y: number; bridge?: boolean }[] = [];
  let previousTime = t[first]!;
  for (let index = first; index <= last; index += 1) {
    if (index !== last && index % stride !== 0) continue;
    const x = dotX - (endS - t[index]!) * pxPerS;
    const y = yOf(v[index]!);
    const previous = points[points.length - 1];
    if (previous && t[index]! - previousTime > GAP_S) {
      points.push({ x, y: previous.y, bridge: true }, { x, y, bridge: true });
    } else {
      points.push({ x, y });
    }
    previousTime = t[index]!;
  }
  const lastY = yOf(v[last]!);
  const lastTime = t[last]!;
  const next = t[last + 1];
  if (next !== undefined && endS > lastTime) {
    if (next - lastTime > GAP_S) {
      points.push({ x: dotX, y: lastY, bridge: true });
      return { d: smoothPath(points, height), dotY: lastY };
    }
    const endY = lastY + (yOf(v[last + 1]!) - lastY) * ((endS - lastTime) / (next - lastTime));
    points.push({ x: dotX, y: endY });
    return { d: smoothPath(points, height), dotY: endY };
  }
  return { d: smoothPath(points, height), dotY: lastY };
}
