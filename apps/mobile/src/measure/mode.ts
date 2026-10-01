export type MeasureMode = 'quick' | 'full';

// Spec §7: Full Scan is the recommended default.
export const DEFAULT_MODE: MeasureMode = 'full';

// Seconds of clean signal each mode asks for (§7 Modes table).
export const MODES = {
  quick: { cleanSeconds: 30 },
  full: { cleanSeconds: 90 },
} as const satisfies Record<MeasureMode, { cleanSeconds: number }>;

// The mode arrives as a URL search param, so any other value falls back to the recommended Full Scan.
export function parseMode(raw: string | string[] | undefined): MeasureMode {
  return raw === 'quick' ? 'quick' : DEFAULT_MODE;
}
