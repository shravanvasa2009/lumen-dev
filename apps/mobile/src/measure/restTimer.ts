import { useEffect, useState } from 'react';

// Spec §7 protocol step 1: sit for 2 minutes before a reading.
export const REST_SECONDS = 120;

export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function useRestTimer(totalSeconds: number) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (remaining === 0) return;
    const tick = setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => clearTimeout(tick);
  }, [remaining]);
  // finished is true only when the whole rest was sat through; skipping or starting early leaves it false.
  return {
    remaining,
    finished: remaining === 0 && !skipped,
    skip: () => {
      setSkipped(true);
      setRemaining(0);
    },
  };
}
