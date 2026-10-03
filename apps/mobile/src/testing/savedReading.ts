import type { ReadingContext } from '@lumen/core';

import { makeReading } from '@/testing/reading';
import { saveReading } from '@/store/readings';

const CONTEXT: ReadingContext = {
  captureFps: 60,
  tier: null,
  mode: 'full',
  restTimerDone: true,
  recordedAt: null,
  motionSpans: [],
  coldHandsSpans: [],
  sqi: null,
  validationRhythmLabel: null,
};

// Writes a reading to the (mock) readings table, optionally with a flagged heart rate, and returns its id.
export async function saveTestReading(
  takenAt: number,
  hr: number,
  { flagged = false }: { flagged?: boolean } = {},
): Promise<string> {
  const { id, outcome } = makeReading(takenAt, hr, 48);
  const results = flagged && outcome.metrics.hr
    ? { ...outcome, metrics: { ...outcome.metrics, hr: { ...outcome.metrics.hr, flag: 'fastResting' as const } } }
    : outcome;
  await saveReading({
    id,
    createdAt: takenAt,
    mode: 'full',
    context: CONTEXT,
    results,
    models: { rhythm: null, diabetes: null },
  });
  return id;
}
