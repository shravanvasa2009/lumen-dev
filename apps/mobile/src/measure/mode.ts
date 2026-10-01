export type MeasureMode = 'quick' | 'full';

// The mode arrives as a URL search param, so any other value falls back to the recommended Full Scan.
export function parseMode(raw: string | string[] | undefined): MeasureMode {
  return raw === 'quick' ? 'quick' : 'full';
}
