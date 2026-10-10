import { makeReading as reading } from '@/testing/reading';

import { latestReading } from './readings';

describe('latestReading', () => {
  it('is null with no readings', () => {
    expect(latestReading([])).toBeNull();
  });

  it('picks the newest reading whatever the order', () => {
    const newest = reading(300, 64, 48);
    expect(latestReading([reading(100, 70, 40), newest, reading(200, 66, 45)])).toBe(newest);
  });
});
