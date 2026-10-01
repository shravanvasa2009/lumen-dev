import { useCallback, useEffect, useState } from 'react';

import { begin, newTest, type ReadingSlot, recordReading, stop, type TestView, viewAt } from './protocol';

const TICK_MS = 250;

type StandingTestSource = {
  now: () => number;
  // Null means this build cannot take a standing reading yet; no number is ever invented.
  readHeartRate: ((minute: ReadingSlot['minute']) => Promise<number | null>) | null;
};

type StandingTestControls = {
  view: TestView;
  canRead: boolean;
  start: () => void;
  takeReading: () => void;
  stopForFaint: () => void;
};

export function useStandingTest({ now, readHeartRate }: StandingTestSource): StandingTestControls {
  const [state, setState] = useState(newTest);
  const [nowMs, setNowMs] = useState(now);
  const running = state.startedAt !== null && state.stoppedAt === null;

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNowMs(now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running, now]);

  const view = viewAt(state, nowMs);
  const dueSlot = view.dueSlot;

  const start = useCallback(() => {
    const startedAt = now();
    setNowMs(startedAt);
    setState((kept) => begin(kept, startedAt));
  }, [now]);

  const takeReading = useCallback(() => {
    if (!dueSlot || !readHeartRate) return;
    void readHeartRate(dueSlot.minute).then((bpm) => {
      if (bpm !== null) setState((kept) => recordReading(kept, dueSlot, bpm));
    });
  }, [dueSlot, readHeartRate]);

  const stopForFaint = useCallback(() => {
    const stoppedAt = now();
    setNowMs(stoppedAt);
    setState((kept) => stop(kept, stoppedAt, true));
  }, [now]);

  return { view, canRead: readHeartRate !== null, start, takeReading, stopForFaint };
}
