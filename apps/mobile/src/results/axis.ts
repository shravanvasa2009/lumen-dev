const minLowMs = 400;
const maxHighMs = 1200;

// 400–1200 ms (50–150 bpm) unless a reading goes outside it; widened in 100 ms steps so no point is
// flattened against the edge.
export function intervalAxis(intervalsMs: readonly number[]): { lowMs: number; highMs: number } {
  return {
    lowMs: Math.min(minLowMs, Math.floor(Math.min(...intervalsMs) / 100) * 100),
    highMs: Math.max(maxHighMs, Math.ceil(Math.max(...intervalsMs) / 100) * 100),
  };
}
