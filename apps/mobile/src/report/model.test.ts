import { readingById, readingsOnDay, type FixtureReading } from '@/results/fixtures';

import { diabetesFor, evidenceSentence, flagCounts, formatFullDate } from './model';

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

describe('evidenceSentence', () => {
  it('joins the label, the figure and the details into sentences', () => {
    expect(
      evidenceSentence('Heart rate', 'Experimental', {
        headline: 'Not yet tested',
        details: ['Reference: Polar H10'],
      }),
    ).toBe('Heart rate: Experimental. Not yet tested. Reference: Polar H10.');
  });
});

describe('dates and days', () => {
  it('writes the full date in the app language', () => {
    expect(formatFullDate(new Date(2026, 8, 27), 'en')).toBe('Sep 27, 2026');
  });

  it('groups fixture readings by calendar day', () => {
    expect(readingsOnDay(demo.createdAt).map(({ id }) => id)).toEqual([
      'demo',
      'demo-flag',
      'demo-inconclusive',
    ]);
    expect(readingsOnDay(new Date(2026, 0, 1))).toEqual([]);
  });
});
