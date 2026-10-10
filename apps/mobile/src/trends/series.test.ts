import { median, personalBand } from './baseline';
import { demoHistory, demoNow } from './demoHistory';
import { chartAxis, trendSeries, type HistoryReading } from './series';

function reading(day: number, hr: number | null, rmssd: number | null = null): HistoryReading {
  return {
    id: `r${day}-${hr}`,
    createdAt: new Date(2026, 8, day, 7, 30),
    mode: rmssd === null ? 'quick' : 'full',
    hr,
    rmssd,
    resp: null,
    rhythm: 'sinus',
    flaggedLowRhythm: null,
    lowerQuality: { hr: null, rmssd: null, resp: null },
    lowerReasons: [],
    caffeine: false,
    intervalsMs: [],
  };
}

describe('median and personal band', () => {
  it('takes the middle value, and the mean of the middle pair for an even count', () => {
    expect(median([])).toBeNull();
    expect(median([70, 60, 65])).toBe(65);
    expect(median([60, 62, 64, 70])).toBe(63);
  });

  it('is still learning below 7 readings (§7)', () => {
    expect(personalBand([60, 61, 62, 63, 64, 65])).toBeNull();
  });

  it('is the median plus and minus 1.5 times the interquartile range (§7)', () => {
    // Sorted: 60 61 62 64 66 68 70. Quartiles by interpolation are 61.5 and 67, so IQR = 5.5.
    const band = personalBand([64, 60, 70, 62, 68, 61, 66]);
    expect(band).toEqual({ low: 64 - 8.25, high: 64 + 8.25 });
  });

  it('collapses to the median when every reading is the same', () => {
    expect(personalBand([60, 60, 60, 60, 60, 60, 60])).toEqual({ low: 60, high: 60 });
  });
});

describe('trendSeries', () => {
  const now = new Date(2026, 8, 30, 12, 0);

  it('keeps only readings with the metric inside the range, oldest first', () => {
    const readings = [reading(29, 70), reading(2, 64), reading(20, null), reading(25, 66)];
    const series = trendSeries(readings, 'hr', '7d', now);
    expect(series.points.map((point) => point.value)).toEqual([66, 70]);
    expect(series.median).toBe(68);
    expect(series.band).toBeNull();
  });

  it('widens with the range', () => {
    const readings = [reading(2, 64), reading(25, 66)];
    expect(trendSeries(readings, 'hr', '7d', now).points).toHaveLength(1);
    expect(trendSeries(readings, 'hr', '30d', now).points).toHaveLength(2);
  });

  it('ignores readings after now', () => {
    expect(trendSeries([reading(30, 64)], 'hr', '7d', new Date(2026, 8, 29)).points).toEqual([]);
  });

  it('computes the band once the history holds 7 readings (§7)', () => {
    const readings = [64, 60, 70, 62, 68, 61, 66].map((hr, index) => reading(24 + index, hr));
    expect(trendSeries(readings, 'hr', '30d', now).band).not.toBeNull();
    expect(trendSeries(readings, 'hr', '7d', now).band).not.toBeNull();
    const learning = trendSeries(readings.slice(0, 6), 'hr', '30d', now);
    expect(learning.band).toBeNull();
    expect(learning.baselineCount).toBe(6);
  });

  it('takes the band and the learning count from the whole history, not the range', () => {
    const old = [64, 60, 70, 62, 68, 61].map((hr, index) => reading(1 + index, hr));
    const recent = reading(29, 66);
    const series = trendSeries([...old, recent], 'hr', '7d', now);
    expect(series.points.map((point) => point.value)).toEqual([66]);
    expect(series.median).toBe(66);
    expect(series.baselineCount).toBe(7);
    expect(series.band).toEqual(personalBand([64, 60, 70, 62, 68, 61, 66]));
    expect(trendSeries(old, 'hr', '7d', now)).toMatchObject({ points: [], baselineCount: 6, band: null });
  });

  it('lists a lower-quality value apart, out of the median and band', () => {
    const lower: HistoryReading = {
      ...reading(20, null),
      id: 'lower',
      lowerQuality: { hr: 99, rmssd: null, resp: null },
    };
    const series = trendSeries([reading(18, 60), lower], 'hr', '30d', new Date(2026, 8, 30, 9, 0));
    expect(series.lowerPoints.map((point) => [point.id, point.value])).toEqual([['lower', 99]]);
    expect(series.median).toBe(60);
    expect(series.baselineCount).toBe(1);
  });

  it('gives an empty series for no readings', () => {
    expect(trendSeries([], 'hr', '30d', now)).toEqual({
      lowerPoints: [],
      flaggedLowRhythms: [],
      points: [],
      median: null,
      band: null,
      baselineCount: 0,
    });
  });
});

describe('demo history', () => {
  it('has 26 sample readings, 12 with HRV, all inside the 30-day range', () => {
    expect(demoHistory).toHaveLength(26);
    expect(trendSeries(demoHistory, 'hr', '30d', demoNow).points).toHaveLength(25);
    expect(trendSeries(demoHistory, 'hrv', '30d', demoNow).points).toHaveLength(12);
  });

  it('shows the same band over 7 and 30 days, from the whole history', () => {
    const hr = trendSeries(demoHistory, 'hr', '30d', demoNow);
    expect(hr.band).not.toBeNull();
    expect(trendSeries(demoHistory, 'hr', '7d', demoNow).band).toEqual(hr.band);
    const hrv = trendSeries(demoHistory, 'hrv', '7d', demoNow);
    expect(hrv.points).toHaveLength(3);
    expect(hrv.band).toEqual(trendSeries(demoHistory, 'hrv', '90d', demoNow).band);
    expect(hrv.band).not.toBeNull();
  });

  it('puts the three fixture readings of Sep 27 in time order', () => {
    const day = demoHistory.filter(
      ({ createdAt }) => createdAt.getDate() === 27 && createdAt.getMonth() === 8,
    );
    expect(day.map(({ id }) => id).sort()).toEqual(['demo', 'demo-flag', 'demo-inconclusive']);
  });
});

describe('chartAxis', () => {
  it('uses gridlines every 5 for a tight heart-rate range', () => {
    expect(chartAxis([58, 64, 71])).toEqual({ low: 55, high: 75, step: 5 });
  });

  it('uses steps of 1 for breathing rates', () => {
    expect(chartAxis([13, 14, 16])).toEqual({ low: 13, high: 16, step: 1 });
  });

  it('keeps an axis for a single value', () => {
    const { low, high } = chartAxis([64]);
    expect(high).toBeGreaterThan(low);
  });
});

describe('flagged lower-quality rhythms', () => {
  const now = new Date(2026, 9, 1, 9, 0);
  const base = {
    mode: 'quick' as const,
    hr: null,
    rmssd: null,
    resp: null,
    rhythm: null,
    lowerQuality: { hr: null, rmssd: null, resp: null },
    lowerReasons: [],
    caffeine: false,
    intervalsMs: [],
  };

  it('lists one in range even without a value, and keeps it out of the median', () => {
    const flagged = {
      ...base,
      id: 'a',
      createdAt: new Date(2026, 9, 1, 7, 0),
      flaggedLowRhythm: 'af' as const,
    };
    const old = { ...base, id: 'b', createdAt: new Date(2026, 0, 1, 7, 0), flaggedLowRhythm: 'af' as const };
    const series = trendSeries([flagged, old], 'hr', '7d', now);
    expect(series.flaggedLowRhythms.map((entry) => entry.id)).toEqual(['a']);
    expect(series.points).toEqual([]);
    expect(series.median).toBeNull();
  });
});
