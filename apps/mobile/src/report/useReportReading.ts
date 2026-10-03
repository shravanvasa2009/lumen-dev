import { fromStored, useResultsReading } from '@/results/useResultsReading';
import { readingById, readingsOnDay, type FixtureReading } from '@/results/fixtures';
import { useStoredReadings } from '@/store/useStoredReadings';

type ReportReading = {
  // undefined while a saved reading loads, null when no reading has that id.
  reading: FixtureReading | null | undefined;
  // The readings of the opened reading's day, earliest first, for the day table and the PDF pages.
  dayReadings: readonly FixtureReading[];
};

// The sample readings (fixtures, Demo) by id, otherwise the reading saved on this phone. Only a saved
// reading's day is read from the store: a Demo reading is never saved, so its day is itself (§8.5).
export function useReportReading(id: string | undefined): ReportReading {
  const reading = useResultsReading(id);
  const stored = useStoredReadings();
  if (!reading) return { reading, dayReadings: [] };
  if (readingById(reading.id)) return { reading, dayReadings: readingsOnDay(reading.createdAt) };
  if (reading.sample) return { reading, dayReadings: [reading] };
  const sameDay = stored
    .filter(({ takenAt }) => new Date(takenAt).toDateString() === reading.createdAt.toDateString())
    .map(fromStored)
    .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  return { reading, dayReadings: sameDay.some((row) => row.id === reading.id) ? sameDay : [reading] };
}
