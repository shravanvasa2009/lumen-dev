import { useEffect, useState } from 'react';

import { profileValue, setProfileValue } from '@/store/profile';

const ONBOARDING_DONE_KEY = 'onboardingDone';

export function finishOnboarding(): Promise<void> {
  return setProfileValue(ONBOARDING_DONE_KEY, 'true');
}

// 'loading' until the profile is read. A failed read is thrown during render and caught by the
// ErrorBoundary exported from app/_layout.tsx, because guessing either answer would send a first-time
// user to Home or an old user to Welcome.
export function useOnboardingState(): 'loading' | 'needed' | 'done' {
  const [done, setDone] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  if (failure !== null) throw failure;
  useEffect(() => {
    let active = true;
    profileValue(ONBOARDING_DONE_KEY).then(
      (saved) => {
        if (active) setDone(saved === 'true');
      },
      (error: unknown) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (done === null) return 'loading';
  return done ? 'done' : 'needed';
}
