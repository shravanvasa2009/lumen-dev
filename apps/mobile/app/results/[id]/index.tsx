import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { finishedReading } from '@/measure/finishedReadings';
import { readingById } from '@/results/fixtures';
import { ReadingResults } from '@/results/ReadingResults';

export default function ResultsScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reading = readingById(id) ?? finishedReading(id);
  // An id with no stored reading shows no values rather than made-up ones.
  return reading ? (
    <ReadingResults key={reading.id} reading={reading} />
  ) : (
    <RouteShell title={t('results.title')} subtitle={t('result.inconclusive')} />
  );
}
