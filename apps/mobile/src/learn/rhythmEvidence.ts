import { isRecord, metricRecord } from '@/evidence';

import bundledEvidence from '../../assets/evidence.json';

export type RhythmFigures = {
  // Share of readings with frequent extra beats that the rhythm check marked irregular (spec 11.3).
  falseAfRate: number | null;
  // Share of readings the rhythm check declined to call.
  readingAbstainRate: number | null;
  // Where the figures come from, as written in evidence.json; null when the file does not say.
  source: string | null;
};

// The file may hold a bare rate or `{ estimate, ci95 }`. Anything that is not a share between 0 and 1 is
// treated as untested rather than shown wrong.
function rateFrom(value: unknown): number | null {
  const rate = isRecord(value) ? value.estimate : value;
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

// Not gated by `passed`: spec 11.3 requires stating the development false-AF rate regardless (ADR 0020
// addendum), while the rhythm label stays gated by readEvidence.
export function readRhythmFigures(file: unknown): RhythmFigures {
  const rhythm = metricRecord(file, 'rhythm');
  return {
    falseAfRate: rateFrom(rhythm.falseAfRatePrematureReadings),
    readingAbstainRate: rateFrom(rhythm.readingAbstainRate),
    source: typeof rhythm.source === 'string' && rhythm.source.trim() !== '' ? rhythm.source : null,
  };
}

export const bundledRhythmFigures = readRhythmFigures(bundledEvidence);
