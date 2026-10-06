import type { StoredReading } from '@/home/readings';

const COLUMNS = [
  'taken_at_utc',
  'mode',
  'heart_rate_bpm',
  'heart_rate_evidence',
  'heart_rate_flag',
  'rhythm_class',
  'rhythm_evidence',
  'rhythm_flag',
  'hrv_rmssd_ms',
  'hrv_evidence',
  'breathing_per_min',
  'breathing_evidence',
  'clean_seconds',
  'beats',
  'rejected_beats',
  'quality',
  'quality_reasons',
];

// Every cell is a number or one of a fixed set of words, never free text, so no quoting is needed.
// A metric that did not meet its clean-data floor is an empty cell. Sorted oldest first, as a log reads.
export function readingsToCsv(readings: readonly StoredReading[]): string {
  const rows = [...readings]
    .sort((first, second) => first.takenAt - second.takenAt)
    .map(({ takenAt, mode, outcome }) => {
      const { hr, rhythm, rmssd, resp } = outcome.metrics;
      return [
        new Date(takenAt).toISOString(),
        mode ?? 'quick',
        hr?.value,
        hr?.evidence,
        hr?.flag,
        rhythm?.class,
        rhythm?.evidence,
        rhythm?.flag,
        rmssd?.value,
        rmssd?.evidence,
        resp?.value,
        resp?.evidence,
        outcome.cleanSeconds,
        outcome.beats,
        outcome.rejectedBeats,
        // ADR 0104; a reading saved before quality existed was standard. Reason kinds are fixed words, '|'-joined.
        outcome.quality?.level ?? 'standard',
        (outcome.quality?.reasons ?? []).map((reason) => reason.kind).join('|'),
      ]
        .map((cell) => cell ?? '')
        .join(',');
    });
  return [COLUMNS.join(','), ...rows].join('\n') + '\n';
}
