import { isRecord, metricRecord } from '@/evidence';

import bundledEvidence from '../../assets/evidence.json';

export type RhythmFigures = {
  // Share of readings with frequent extra beats that the rhythm check marked irregular (spec 11.3).
  falseAfRate: number | null;
  // Share of readings the rhythm check declined to call.
  readingAbstainRate: number | null;
};

// The file may hold a bare rate or `{ estimate, ci95 }`. Anything that is not a share between 0 and 1 is
// treated as untested rather than shown wrong.
function rateFrom(value: unknown): number | null {
  const rate = isRecord(value) ? value.estimate : value;
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

export function readRhythmFigures(file: unknown): RhythmFigures {
  const rhythm = metricRecord(file, 'rhythm');
  return {
    falseAfRate: rateFrom(rhythm.falseAfRatePrematureReadings),
    readingAbstainRate: rateFrom(rhythm.readingAbstainRate),
  };
}

export const bundledRhythmFigures = readRhythmFigures(bundledEvidence);
