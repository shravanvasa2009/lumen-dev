import { makeReading as reading } from '@/testing/reading';

import { latestReading, tileSeries } from './readings';

describe('latestReading', () => {
  it('is null with no readings', () => {
    expect(latestReading([])).toBeNull();
  });

  it('picks the newest reading whatever the order', () => {
    const newest = reading(300, 64, 48);
    expect(latestReading([reading(100, 70, 40), newest, reading(200, 66, 45)])).toBe(newest);
  });
});

describe('tileSeries', () => {
  it('is empty with no readings', () => {
    expect(tileSeries([], 'hr')).toEqual([]);
  });

  it('runs oldest to newest and skips readings that lack the metric', () => {
    const readings = [reading(300, 64, null), reading(100, 70, 40), reading(200, 66, 45)];
    expect(tileSeries(readings, 'hr')).toEqual([70, 66, 64]);
    expect(tileSeries(readings, 'rmssd')).toEqual([40, 45]);
    expect(tileSeries(readings, 'resp')).toEqual([]);
  });

  it('leaves lower-quality values off the tile, which has no room for the tag (ADR 0104)', () => {
    const low = reading(200, 99, null);
    low.outcome.metrics.hr!.quality = 'low';
    expect(tileSeries([reading(100, 70, 40), low, reading(300, 64, null)], 'hr')).toEqual([70, 64]);
  });

  it('keeps only the last seven points', () => {
    const readings = Array.from({ length: 10 }, (_, index) => reading(index, 60 + index, null));
    expect(tileSeries(readings, 'hr')).toEqual([63, 64, 65, 66, 67, 68, 69]);
  });
});
