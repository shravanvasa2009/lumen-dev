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
  useEffect(() => {
    if (remaining === 0) return;
    const tick = setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => clearTimeout(tick);
  }, [remaining]);
  return { remaining, skip: () => setRemaining(0) };
}
