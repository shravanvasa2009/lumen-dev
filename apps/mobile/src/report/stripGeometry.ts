import { intervalAxis } from '@/results/axis';

export const stripWidth = 320;
export const stripHeight = 56;
export const stripInset = 6;

export type StripPoint = { x: number; y: number };

// One scale for the on-screen strip and the PDF strip, so the two never disagree about a reading.
export function stripPoints(intervalsMs: readonly number[]): StripPoint[] {
  const { lowMs, highMs } = intervalAxis(intervalsMs);
  return intervalsMs.map((ms, index) => ({
    x: stripInset + (index / Math.max(1, intervalsMs.length - 1)) * (stripWidth - 2 * stripInset),
    y: stripInset + ((highMs - ms) / (highMs - lowMs)) * (stripHeight - 2 * stripInset),
  }));
}
