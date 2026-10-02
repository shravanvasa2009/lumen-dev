export type MeasureMode = 'quick' | 'full';

// The mode arrives as a URL search param, so any other value falls back to the recommended Full Scan.
export function parseMode(raw: string | string[] | undefined): MeasureMode {
  return raw === 'quick' ? 'quick' : 'full';
}

// Clean seconds each mode needs before the reading can finish (spec §6.2; mockups 13 and 14).
export function cleanSecondsNeeded(mode: MeasureMode): number {
  return mode === 'quick' ? 30 : 90;
}

// What pre-check passes on to the reading: whether the rest timer ran to the end and the context chips.
// Both are kept as the route's own strings, and only the ones present are handed on.
export function processingHref(mode: MeasureMode, restDone?: string, context?: string): string {
  const params = new URLSearchParams({ mode });
  if (restDone !== undefined) params.set('restDone', restDone);
  if (context !== undefined) params.set('context', context);
  return `/measure/processing?${params.toString()}`;
}
