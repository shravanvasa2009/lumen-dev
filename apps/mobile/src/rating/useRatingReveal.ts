import Constants from 'expo-constants';
import { useEffect, useState } from 'react';

import { keptCapture } from '@/measure/keptCapture';
import { usePhoneProbe } from '@/onboarding/usePhoneProbe';
import { loadDeviceRating, type StoredRating } from '@/store/deviceRating';

import { ratePhone } from './ratePhone';

export type RatingReveal =
  | { kind: 'measuring' }
  | { kind: 'rated'; rating: StoredRating }
  // Neither the probe nor the practice settled a tier, and no earlier rating is stored.
  | { kind: 'unrated' };

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Onboarding step 8 (mockup 08): rates the phone from the probe and the practice capture just kept in
// memory, stores it, and falls back to the rating already stored when this run cannot settle one.
export function useRatingReveal(): RatingReveal {
  const probe = usePhoneProbe();
  const [reveal, setReveal] = useState<RatingReveal>({ kind: 'measuring' });
  useEffect(() => {
    if (probe.kind === 'checking') return;
    let current = true;
    // A run that fails is reported, and the rating stored before it stays on show.
    const rated =
      probe.kind === 'ready'
        ? ratePhone(probe.capabilities, keptCapture(), Constants.expoConfig?.version ?? null)
            .catch((error: unknown) => {
              console.warn(`Rating the phone failed: ${reasonOf(error)}`);
              return null;
            })
            .then((fresh) => fresh ?? loadDeviceRating())
        : loadDeviceRating();
    rated.then(
      (rating) => {
        if (current) setReveal(rating === null ? { kind: 'unrated' } : { kind: 'rated', rating });
      },
      (error: unknown) => {
        console.warn(`Reading the stored rating failed: ${reasonOf(error)}`);
        if (current) setReveal({ kind: 'unrated' });
      },
    );
    return () => {
      current = false;
    };
  }, [probe]);
  return reveal;
}
