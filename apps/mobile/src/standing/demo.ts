import type { ReadingSlot } from './protocol';

// Demo timers run this many times faster than the wall clock so the whole 15-minute protocol fits in a tour.
export const DEMO_SPEED = 10;

// Sample values for the demo only; they are not measurements and never leave the screen.
const DEMO_SERIES: Readonly<Record<ReadingSlot['minute'], number>> = { 0: 68, 1: 84, 3: 88, 5: 91, 10: 89 };

export function demoClock(): number {
  return Date.now() * DEMO_SPEED;
}

export function readDemoHeartRate(minute: ReadingSlot['minute']): Promise<number> {
  return Promise.resolve(DEMO_SERIES[minute]);
}
