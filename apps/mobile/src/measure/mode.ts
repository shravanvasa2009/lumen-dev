export type MeasureMode = 'quick' | 'full';

// Spec §12 (Modes): Full Scan is the default.
export const DEFAULT_MODE: MeasureMode = 'full';

export type ModeDuration = { amount: number; unit: 'seconds' | 'minutes'; approximate?: true };

// Every mode of the spec §12 Modes table. Quick and Full are seconds of clean signal; Deep HRV and the
// Standing test are minutes of guided time, the latter only about.
export const MODES = {
  quick: { duration: { amount: 30, unit: 'seconds' } },
  full: { duration: { amount: 90, unit: 'seconds' } },
  deep: { duration: { amount: 5, unit: 'minutes' } },
  standing: { duration: { amount: 12, unit: 'minutes', approximate: true } },
} as const satisfies Record<string, { duration: ModeDuration }>;

// The mode arrives as a URL search param, so any other value falls back to the recommended Full Scan.
export function parseMode(raw: string | string[] | undefined): MeasureMode {
  return raw === 'quick' ? 'quick' : DEFAULT_MODE;
}

// Clean seconds each mode needs before the reading can finish (spec §12 Modes; mockups 13 and 14).
export function cleanSecondsNeeded(mode: MeasureMode): number {
  return MODES[mode].duration.amount;
}

// What pre-check passes on to the reading: whether the rest timer ran to the end and the context chips.
// Both are kept as the route's own strings, and only the ones present are handed on.
export function processingHref(mode: MeasureMode, restDone?: string, context?: string): string {
  const params = new URLSearchParams({ mode });
  if (restDone !== undefined) params.set('restDone', restDone);
  if (context !== undefined) params.set('context', context);
  return `/measure/processing?${params.toString()}`;
}
