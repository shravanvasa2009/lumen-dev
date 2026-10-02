import { dominantCause, parseCause } from './causes';

describe('fix causes', () => {
  it('picks the cause that lost the most seconds', () => {
    expect(dominantCause({ motion: 31, pressure: 13, coverage: 8, coldHands: 0 })).toBe('motion');
    expect(dominantCause({ motion: 1, pressure: 13, coverage: 8, coldHands: 20 })).toBe('coldHands');
  });

  it('names no cause when no seconds were lost', () => {
    expect(dominantCause({ motion: 0, pressure: 0, coverage: 0, coldHands: 0 })).toBeNull();
  });

  it('accepts only known causes from the URL', () => {
    expect(parseCause('pressure')).toBe('pressure');
    expect(parseCause('red')).toBeNull();
    expect(parseCause(undefined)).toBeNull();
  });
});
