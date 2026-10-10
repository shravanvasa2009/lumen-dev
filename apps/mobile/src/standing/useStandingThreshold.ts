import { useEffect, useState } from 'react';

import { riseThresholdBpm } from '@lumen/core';

import { loadRiskDraft } from '@/store/profile';

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Null when the profile has no age the core rule accepts (none given, under 13, or not whole years).
export function thresholdForAge(ageYears: number | null): number | null {
  if (ageYears === null) return null;
  try {
    return riseThresholdBpm(ageYears);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

// The rise the flag fires at for this person, read from the same core rule the result uses.
export function useStandingThreshold(): number | null {
  const [threshold, setThreshold] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    loadRiskDraft().then(
      (stored) => {
        if (active) setThreshold(thresholdForAge(stored.ageYears));
      },
      (error: unknown) => {
        console.warn(`Profile age did not load for the standing chart: ${reasonOf(error)}`);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return threshold;
}
