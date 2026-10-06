import { quantileRange } from './waveformScale';

describe('quantileRange', () => {
  it('has no range for no values', () => {
    expect(quantileRange([], 0, 1)).toBeNull();
  });

  it('is the plain minimum and maximum at 0 and 1', () => {
    expect(quantileRange([3, 1, 2], 0, 1)).toEqual({ low: 1, high: 3 });
  });

  it('ignores one spike among 100 values at the 3rd and 97th percentiles', () => {
    const beats = Array.from({ length: 99 }, (_, index) => Math.sin(index / 5));
    const range = quantileRange([...beats, 50], 0.03, 0.97)!;
    expect(range.high).toBeLessThan(1.01);
    expect(range.low).toBeGreaterThan(-1.01);
  });
});
