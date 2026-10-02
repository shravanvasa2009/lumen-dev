import { dateLine, dayPeriod, readingMoment } from './moment';

describe('dayPeriod', () => {
  it.each([
    [0, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)("calls %i o'clock the %s", (hour, period) => {
    expect(dayPeriod(hour)).toBe(period);
  });
});

describe('dateLine', () => {
  const sunday = new Date(2026, 8, 27, 7, 42);

  it('writes weekday, month and day in English', () => {
    expect(dateLine(sunday, 'en')).toBe('Sunday, Sep 27');
  });

  it('writes the same date in Spanish', () => {
    expect(dateLine(sunday, 'es').toLowerCase()).toContain('domingo');
  });
});

describe('readingMoment', () => {
  const now = new Date(2026, 8, 27, 20, 0);

  it('marks a reading from earlier the same day as today', () => {
    const moment = readingMoment(new Date(2026, 8, 27, 7, 42).getTime(), now, 'en');
    expect(moment).toMatchObject({ today: true, date: 'Sep 27' });
    expect(moment.time).toMatch(/^7:42\s?AM$/);
  });

  it('marks a reading from the day before as not today', () => {
    expect(readingMoment(new Date(2026, 8, 26, 7, 42).getTime(), now, 'en').today).toBe(false);
  });
});
