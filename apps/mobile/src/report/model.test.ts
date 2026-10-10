import { readingById, readingsOnDay, type FixtureReading } from '@/results/fixtures';

import i18next from 'i18next';

import '@/i18n';
import en from '@/i18n/en.json';

import {
  diabetesFor,
  evidenceBody,
  flagCounts,
  formatFullDate,
  inconclusiveLines,
  measurementLines,
  pdfPageReadings,
  qualityNote,
  qualityLines,
  tableRows,
} from './model';

const demo = readingById('demo') as FixtureReading;
const flagged = readingById('demo-flag') as FixtureReading;
const inconclusive = readingById('demo-inconclusive') as FixtureReading;

describe('flagCounts', () => {
  it('counts a flag out of the readings that had a result for the card', () => {
    expect(flagCounts([demo, flagged, inconclusive])).toEqual({
      rhythm: { flagged: 1, total: 2 },
      hr: { flagged: 0, total: 2 },
    });
  });

  it('is empty for no readings', () => {
    expect(flagCounts([])).toEqual({ rhythm: { flagged: 0, total: 0 }, hr: { flagged: 0, total: 0 } });
  });
});

describe('lower-quality readings in the report (ADR 0104)', () => {
  const t = i18next.getFixedT('en');
  const low: FixtureReading = {
    ...demo,
    scan: {
      ...demo.scan,
      quality: { level: 'low', reasons: [{ kind: 'shortClean', haveS: 40, wantS: 60 }] },
      metrics: {
        ...demo.scan.metrics,
        hr: { ...demo.scan.metrics.hr!, quality: 'low', qualityReasons: ['shortClean'], qualityDetails: [] },
        rhythm: {
          ...demo.scan.metrics.rhythm!,
          quality: 'low',
          qualityReasons: ['shortClean'],
          qualityDetails: [],
        },
      },
    },
  };

  it('tags the heart rate and rhythm cells', () => {
    const { cells } = tableRows(t, 'en', [low])[0]!;
    expect(cells[2]).toBe(en['quality.marked'].replace('{{value}}', '64'));
    expect(cells[3]).toBe(en['quality.marked'].replace('{{value}}', en['results.rhythmRegular']));
    expect(tableRows(t, 'en', [demo])[0]!.cells[2]).toBe('64');
  });

  it('adds a line with the time and the reasons for each lower-quality reading, none for a standard one', () => {
    const [line] = qualityLines(t, 'en', [demo, low]);
    expect(qualityLines(t, 'en', [demo])).toEqual([]);
    expect(line).toContain(en['quality.chip']);
    expect(line).toContain('Only 40 of 60 clean seconds');
  });
});

describe('quality note and measurement lines', () => {
  const t = i18next.getFixedT('en');
  const low: FixtureReading = {
    ...demo,
    scan: {
      ...demo.scan,
      quality: { level: 'low', reasons: [{ kind: 'shortClean', haveS: 40, wantS: 60 }] },
    },
  };

  it('writes a plain quality note with the reasons for a lower-quality reading, and none for a standard one', () => {
    expect(qualityNote(t, low)).toBe(`${en['report.qualityNote']} Only 40 of 60 clean seconds.`);
    expect(qualityNote(t, demo)).toBeNull();
  });

  it('lists only the values the scan produced', () => {
    expect(measurementLines(t, demo).map(({ key }) => key)).toEqual(['hr', 'rhythm', 'hrv', 'resp']);
    expect(measurementLines(t, demo)[0]).toMatchObject({ title: 'Heart rate', value: '64 bpm' });
    expect(measurementLines(t, inconclusive)).toEqual([]);
  });
});

describe('inconclusiveLines', () => {
  const t = i18next.getFixedT('en');
  const outcome = {
    kind: 'inconclusive' as const,
    reasons: ['tooFewCleanSeconds' as const],
    cleanSeconds: 22.9,
    neededCleanSeconds: 90,
    lostSeconds: { motion: 40, pressure: 16, coverage: 10, coldHands: 0 },
    otherLostSeconds: 0,
    causes: ['motion' as const],
    urgent: null,
  };

  it('reports only what was measured, why it fell short, and the pre-check answers', () => {
    const { facts, lost } = inconclusiveLines(t, outcome, ['caffeine', 'bogus']);
    expect(facts).toEqual([
      '22 clean seconds collected of the 90 needed.',
      'Most of the lost time was movement.',
      'Before this reading: Caffeine.',
      en['report.noValues'],
    ]);
    expect(lost).toEqual(['Movement 61%', 'Pressure 24%', 'Light 15%']);
  });

  it('leaves out the breakdown and the context lines when there are none', () => {
    const { facts, lost } = inconclusiveLines(
      t,
      { ...outcome, causes: [], lostSeconds: { motion: 0, pressure: 0, coverage: 0, coldHands: 0 } },
      [],
    );
    expect(facts).toHaveLength(2);
    expect(lost).toEqual([]);
  });
});

describe('pdfPageReadings', () => {
  it('is the flagged readings of the day, in the day order', () => {
    const second = { ...flagged, id: 'second-flag' };
    expect(pdfPageReadings(demo, [inconclusive, flagged, demo, second]).map(({ id }) => id)).toEqual([
      'demo-flag',
      'second-flag',
    ]);
  });

  it('falls back to the opened reading when nothing is flagged', () => {
    expect(pdfPageReadings(demo, [inconclusive, demo])).toEqual([demo]);
  });
});

describe('diabetesFor', () => {
  it('is hidden until the evidence file passes the metric', () => {
    expect(diabetesFor([demo], false)).toBeNull();
  });

  it('returns the estimate and its days once it passed', () => {
    expect(diabetesFor([flagged, demo], true)?.metric.readingsUsed).toBe(2);
  });

  it('is hidden when no reading that day has an estimate', () => {
    expect(diabetesFor([flagged], true)).toBeNull();
  });
});

describe('evidenceBody', () => {
  it('joins the label, the figure and the details into sentences', () => {
    expect(
      evidenceBody('Experimental', {
        headline: 'Not yet tested',
        details: ['Reference: Polar H10'],
      }),
    ).toBe('Experimental. Not yet tested. Reference: Polar H10.');
  });
});

describe('dates and days', () => {
  it('writes the full date in the app language', () => {
    expect(formatFullDate(new Date(2026, 8, 27), 'en')).toBe('Sep 27, 2026');
  });

  it('groups fixture readings by calendar day', () => {
    expect(readingsOnDay(demo.createdAt).map(({ id }) => id)).toEqual([
      'demo-inconclusive',
      'demo',
      'demo-flag',
    ]);
    expect(readingsOnDay(new Date(2026, 0, 1))).toEqual([]);
  });
});
