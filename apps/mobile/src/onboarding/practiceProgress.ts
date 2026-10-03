// H-047 option A (ADR 0074): practice passes after 30 steady seconds, not spec §8.2's 15, so it holds the
// 30 clean seconds DSP-10 needs for a perfusion index and the phone gets a real rating.
export const STEADY_SECONDS_NEEDED = 30;

// A capture that ends the moment the session counts 30.0 s analyses to just under 30 clean seconds (the
// analysis counts first frame to last frame), which leaves DSP-10 without a perfusion index. The ring
// therefore reads full only 1 s later; the 30 s rule itself is unchanged.
export const HOLD_PAST_NEEDED_S = 1;

/** The steady seconds to show: whole seconds, held at one short of the target until the extra hold is in. */
export function practiceSteadySeconds(cleanSeconds: number | null): number {
  const clean = cleanSeconds ?? 0;
  if (clean >= STEADY_SECONDS_NEEDED + HOLD_PAST_NEEDED_S) return STEADY_SECONDS_NEEDED;
  return Math.min(Math.floor(clean), STEADY_SECONDS_NEEDED - 1);
}
