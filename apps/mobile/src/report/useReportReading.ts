import { fromStored, useResultsReading } from '@/results/useResultsReading';
import { readingById, readingsOnDay, type FixtureReading } from '@/results/fixtures';
import { useLoadedReadings } from '@/store/useStoredReadings';

type ReportReading = {
  // undefined while a saved reading loads, null when no reading has that id.
  reading: FixtureReading | null | undefined;
  // The readings of the opened reading's day, earliest first, for the day table and the PDF pages.
  dayReadings: readonly FixtureReading[];
  // False while a saved reading's day is still loading: a PDF made now would miss the day's other flags.
  dayReady: boolean;
};

// The sample readings (fixtures, Demo) by id, otherwise the reading saved on this phone. Only a saved
// reading's day is read from the store: a Demo reading is never saved, so its day is itself (§8.5).
export function useReportReading(id: string | undefined): ReportReading {
  const reading = useResultsReading(id);
  const stored = useLoadedReadings();
  if (!reading) return { reading, dayReadings: [], dayReady: false };
  if (readingById(reading.id)) return { reading, dayReadings: readingsOnDay(reading.createdAt), dayReady: true };
  if (reading.sample) return { reading, dayReadings: [reading], dayReady: true };
  const sameDay = (stored ?? [])
    .filter(({ takenAt }) => new Date(takenAt).toDateString() === reading.createdAt.toDateString())
    .map(fromStored)
    .sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
  return {
    reading,
    dayReadings: sameDay.some((row) => row.id === reading.id) ? sameDay : [reading],
    dayReady: stored !== null,
  };
}
