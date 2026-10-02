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
