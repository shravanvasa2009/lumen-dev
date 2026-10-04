import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { ReadingResults } from '@/results/ReadingResults';
import { useResultsReading } from '@/results/useResultsReading';

export default function ResultsScreen() {
  const { t } = useTranslation();
  const { id, symptomsAsked } = useLocalSearchParams<{ id: string; symptomsAsked?: string }>();
  const reading = useResultsReading(id);
  if (reading === undefined) return <RouteShell title={t('results.title')} />;
  // An id with no stored reading shows no values rather than made-up ones.
  return reading ? (
    <ReadingResults key={reading.id} reading={reading} symptomsAsked={symptomsAsked === 'true'} />
  ) : (
    <RouteShell title={t('results.title')} subtitle={t('result.inconclusive')} />
  );
}
