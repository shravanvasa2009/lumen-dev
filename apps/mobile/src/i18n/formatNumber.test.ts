import { formatNumber } from './formatNumber';

describe('formatNumber', () => {
  it('uses the decimal point in English and the decimal comma in Spanish', () => {
    expect(formatNumber(1.6, 'en')).toBe('1.6');
    expect(formatNumber(1.6, 'es')).toBe('1,6');
  });

  it('rounds to the most digits asked for and pads to the fewest', () => {
    expect(formatNumber(0.66607, 'es')).toBe('0,7');
    expect(formatNumber(2, 'es')).toBe('2');
    expect(formatNumber(29, 'es', 1, 1)).toBe('29,0');
    expect(formatNumber(29, 'en', 1, 1)).toBe('29.0');
  });
});
