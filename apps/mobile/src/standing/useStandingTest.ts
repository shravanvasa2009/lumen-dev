import { useCallback, useEffect, useRef, useState } from 'react';

import { begin, newTest, type ReadingSlot, recordReading, stop, type TestView, viewAt } from './protocol';

const TICK_MS = 250;

export type StandingTestSource = {
  now: () => number;
  // Null means this build cannot take a standing reading yet; no number is ever invented.
  readHeartRate: ((minute: ReadingSlot['minute']) => Promise<number | null>) | null;
};

type StandingTestControls = {
  view: TestView;
  canRead: boolean;
  reading: boolean;
  readFailed: boolean;
  start: () => void;
  takeReading: () => void;
  stopForFaint: () => void;
};

export function useStandingTest({ now, readHeartRate }: StandingTestSource): StandingTestControls {
  const [state, setState] = useState(newTest);
  const [nowMs, setNowMs] = useState(now);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const readingNow = useRef(false);
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
    if (!dueSlot || !readHeartRate || readingNow.current) return;
    readingNow.current = true;
    setReading(true);
    setReadFailed(false);
    readHeartRate(dueSlot.minute)
      .then((bpm) => {
        if (bpm === null) setReadFailed(true);
        else setState((kept) => recordReading(kept, dueSlot, bpm, now()));
      })
      .catch(() => setReadFailed(true))
      .finally(() => {
        readingNow.current = false;
        setReading(false);
      });
  }, [dueSlot, readHeartRate, now]);

  const stopForFaint = useCallback(() => {
    const stoppedAt = now();
    setNowMs(stoppedAt);
    setState((kept) => stop(kept, stoppedAt));
  }, [now]);

  return { view, canRead: readHeartRate !== null, reading, readFailed, start, takeReading, stopForFaint };
}
