import { easeRange, smoothPath } from './waveformPath';

describe('smoothPath', () => {
  it('is empty for no points', () => {
    expect(smoothPath([], 50)).toBe('');
  });

  it('starts at the first point and ends at the last through cubic segments', () => {
    const path = smoothPath(
      [
        { x: 0, y: 10 },
        { x: 10, y: 30 },
        { x: 20, y: 20 },
      ],
      50,
    );
    expect(path.startsWith('M0.0,10.0C')).toBe(true);
    expect(path.endsWith('20.0,20.0')).toBe(true);
    expect(path.match(/C/g)).toHaveLength(2);
  });

  it('keeps control points inside the card on a steep beat', () => {
    const path = smoothPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 50 },
        { x: 2, y: 0 },
        { x: 3, y: 50 },
      ],
      50,
    );
    const ys = [...path.matchAll(/,(-?\d+\.\d)/g)].map((match) => Number(match[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(50);
  });
});

describe('easeRange', () => {
  const current = { low: 0, high: 10 };
  const target = { low: 10, high: 30 };

  it('takes the first range as is and keeps the old one without a target', () => {
    expect(easeRange(null, target, 100, 400)).toEqual(target);
    expect(easeRange(current, null, 100, 400)).toEqual(current);
  });

  it('moves part of the way, never past the target', () => {
    const eased = easeRange(current, target, 100, 400)!;
    expect(eased.low).toBeGreaterThan(0);
    expect(eased.low).toBeLessThan(10);
    expect(easeRange(current, target, 1e9, 400)!.high).toBeCloseTo(30);
  });

  it('does not move when no time passed', () => {
    expect(easeRange(current, target, 0, 400)).toEqual(current);
  });
});
