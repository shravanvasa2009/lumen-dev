import type { SavedReading } from '@/store/readings';

import nitin from './seed/nitin.json';
import shravan from './seed/shravan.json';
import { seededAt, seedHistory, type SeedReading } from './seedHistory';

const mockList = jest.fn();
const mockSave = jest.fn();
jest.mock('@/store/readings', () => ({
  listReadings: () => mockList(),
  saveReading: (reading: unknown) => mockSave(reading),
}));
jest.mock('@/store/database', () => ({
  lumenDatabase: async () => ({ withTransactionAsync: async (task: () => Promise<void>) => task() }),
}));

// The film's two people (owner, 2026-10-17): resting HR, RMSSD and breathing spreads.
const people = [
  { name: 'Shravan', readings: shravan as unknown as SeedReading[], hr: [68, 77], rmssd: [30, 50], resp: 14 },
  { name: 'Nitin', readings: nitin as unknown as SeedReading[], hr: [57, 66], rmssd: [50, 75], resp: 13 },
];

describe.each(people)('$name seed', ({ readings, hr, rmssd, resp }) => {
  it('has about 24 Full Scans on different mornings in the last 30 days, not today', () => {
    expect(readings.length).toBeGreaterThanOrEqual(22);
    expect(readings.length).toBeLessThanOrEqual(27);
    expect(new Set(readings.map((reading) => reading.daysAgo)).size).toBe(readings.length);
    for (const { daysAgo, minuteOfDay, mode } of readings) {
      expect(daysAgo).toBeGreaterThanOrEqual(1);
      expect(daysAgo).toBeLessThanOrEqual(30);
      expect(minuteOfDay).toBeGreaterThanOrEqual(7 * 60);
      expect(minuteOfDay).toBeLessThanOrEqual(8 * 60 + 40);
      expect(mode).toBe('full');
    }
  });

  it.each(readings.map((reading) => [reading.daysAgo, reading] as const))(
    'day -%i is a standard, unflagged regular reading in range',
    (_daysAgo, { results }) => {
      const { hr: rate, rhythm, rmssd: hrv, resp: breathing, diabetes } = results.metrics;
      expect(results.quality).toEqual({ level: 'standard', reasons: [] });
      expect(results.headlineKey).toBe('result.regular');
      expect(rate?.quality).toBe('standard');
      expect(rate?.flag).toBeNull();
      expect(rhythm?.class).toBe('sinus');
      expect(rhythm?.flag).toBeNull();
      expect(diabetes?.flag).toBeNull();
      expect(rate?.value).toBeGreaterThanOrEqual(hr[0]!);
      expect(rate?.value).toBeLessThanOrEqual(hr[1]!);
      expect(hrv?.quality).toBe('standard');
      expect(hrv?.value).toBeGreaterThanOrEqual(rmssd[0]!);
      expect(hrv?.value).toBeLessThanOrEqual(rmssd[1]!);
      expect(breathing?.quality).toBe('standard');
      expect(Math.abs(breathing!.value - resp)).toBeLessThanOrEqual(2.5);
    },
  );

  it.each(readings.map((reading) => [reading.daysAgo, reading] as const))(
    'day -%i intervals match its heart rate',
    (_daysAgo, { results, intervalsMs }) => {
      const meanMs = intervalsMs.reduce((total, ms) => total + ms, 0) / intervalsMs.length;
      const expectedMs = 60000 / results.metrics.hr!.value;
      expect(intervalsMs.length).toBeGreaterThan(80);
      expect(Math.abs(meanMs - expectedMs) / expectedMs).toBeLessThan(0.03);
    },
  );
});

describe('seedHistory', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockSave.mockReset();
  });

  it('places each reading in the morning of its local day', () => {
    const now = new Date(2026, 9, 26, 20, 0).getTime();
    const at = new Date(seededAt(now, 3, 7 * 60 + 25));
    expect([at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([9, 23, 7, 25]);
  });

  it('fills an empty table with dated readings and leaves a used one alone', async () => {
    const now = new Date(2026, 9, 26, 20, 0).getTime();
    mockList.mockResolvedValue([]);
    const saved = await seedHistory(now);
    expect(saved).toBeGreaterThan(20);
    expect(mockSave).toHaveBeenCalledTimes(saved);
    const first = mockSave.mock.calls[0]![0] as SavedReading;
    expect(first.context.recordedAt?.ms).toBe(first.createdAt);
    expect(first.id).toBe(`reading-${first.createdAt}`);

    mockSave.mockReset();
    mockList.mockResolvedValue([first]);
    expect(await seedHistory(now)).toBe(0);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
