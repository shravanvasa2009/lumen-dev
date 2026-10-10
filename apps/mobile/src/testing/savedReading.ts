import type { ReadingContext } from '@lumen/core';

import type { MeasureMode } from '@/measure/mode';
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

// Writes a reading to the (mock) readings table, optionally with a flagged heart rate or beat intervals, and
// returns its id.
export async function saveTestReading(
  takenAt: number,
  hr: number,
  {
    flagged = false,
    lowerQuality = false,
    mode = 'full',
    intervalsMs = [],
  }: { flagged?: boolean; lowerQuality?: boolean; mode?: MeasureMode; intervalsMs?: readonly number[] } = {},
): Promise<string> {
  const { id, outcome } = makeReading(takenAt, hr, 48);
  const heartRate = outcome.metrics.hr;
  const results =
    heartRate && (flagged || lowerQuality)
      ? {
          ...outcome,
          metrics: {
            ...outcome.metrics,
            hr: {
              ...heartRate,
              flag: flagged ? ('fastResting' as const) : heartRate.flag,
              quality: lowerQuality ? ('low' as const) : heartRate.quality,
            },
          },
        }
      : outcome;
  await saveReading({
    id,
    createdAt: takenAt,
    mode,
    context: CONTEXT,
    results,
    models: { rhythm: null, diabetes: null },
    intervalsMs,
  });
  return id;
}
