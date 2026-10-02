import type { LostSeconds } from '@lumen/core';

export type FixCause = 'pressure' | 'motion' | 'coverage' | 'coldHands';

const fixCauses: readonly FixCause[] = ['pressure', 'motion', 'coverage', 'coldHands'];

// The cause arrives as a URL search param, so anything unknown means no tailored lesson.
export function parseCause(raw: string | string[] | undefined): FixCause | null {
  return fixCauses.find((cause) => cause === raw) ?? null;
}

// The cause that lost the most seconds; null when nothing was lost, so no lesson is implied.
export function dominantCause(lost: LostSeconds): FixCause | null {
  const [biggest] = [...fixCauses].sort((first, second) => lost[second] - lost[first]);
  return biggest && lost[biggest] > 0 ? biggest : null;
}
