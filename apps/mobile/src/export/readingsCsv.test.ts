import { makeReading } from '@/testing/reading';

import { readingsToCsv } from './readingsCsv';

describe('readingsToCsv', () => {
  it('writes a header and one row per reading, oldest first', () => {
    const csv = readingsToCsv([
      { ...makeReading(Date.UTC(2026, 9, 2, 12), 70, 40), mode: 'full' },
      { ...makeReading(Date.UTC(2026, 9, 1, 8), 64, 48), mode: 'quick' },
    ]);
    const [header, first, second, end] = csv.split('\n');
    expect(header).toBe(
      'taken_at_utc,mode,heart_rate_bpm,heart_rate_evidence,heart_rate_flag,rhythm_class,rhythm_evidence,' +
        'rhythm_flag,hrv_rmssd_ms,hrv_evidence,breathing_per_min,breathing_evidence,clean_seconds,beats,' +
        'rejected_beats,quality,quality_reasons',
    );
    expect(first).toBe(
      '2026-10-01T08:00:00.000Z,quick,64,experimental,,,,,48,experimental,,,90,100,0,standard,',
    );
    expect(second).toBe(
      '2026-10-02T12:00:00.000Z,full,70,experimental,,,,,40,experimental,,,90,100,0,standard,',
    );
    expect(end).toBe('');
  });

  it('leaves a cell empty for a metric that was not reported', () => {
    const [, row] = readingsToCsv([makeReading(0, null, null)]).split('\n');
    expect(row).toBe('1970-01-01T00:00:00.000Z,quick,,,,,,,,,,,90,100,0,standard,');
  });

  it('names a lower-quality reading and its reasons as fixed words (ADR 0104)', () => {
    const low = makeReading(0, 64, null);
    low.outcome.quality = {
      level: 'low',
      reasons: [{ kind: 'quickMode' }, { kind: 'shortClean', haveS: 20, wantS: 60 }],
    };
    const [, row] = readingsToCsv([low]).split('\n');
    expect(row!.endsWith(',low,quickMode|shortClean')).toBe(true);
  });

  it('is only a header for no readings', () => {
    expect(readingsToCsv([]).split('\n')).toHaveLength(2);
  });
});
