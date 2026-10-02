import { formatDate, formatNumber, formatPercent } from './format';

describe('formatting', () => {
  it('writes a share as a whole percent, and a tiny share as under one percent', () => {
    expect(formatPercent(0.3, 'en')).toBe('30%');
    expect(formatPercent(0.003, 'en')).toBe('<1%');
    expect(formatPercent(0, 'en')).toBe('0%');
  });

  it('follows the language for the decimal mark', () => {
    expect(formatNumber(1.6, 'en')).toBe('1.6');
    expect(formatNumber(1.6, 'es')).toBe('1,6');
  });

  it('reads the date in UTC and rejects text that is not a date', () => {
    expect(formatDate('2026-10-20', 'en')).toBe('Oct 20');
    expect(formatDate('not a date', 'en')).toBeNull();
  });
});
