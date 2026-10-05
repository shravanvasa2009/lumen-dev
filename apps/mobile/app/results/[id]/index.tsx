import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { ReadingResults } from '@/results/ReadingResults';
import { clearSymptomsAsked } from '@/results/symptomsAsked';
import { useResultsReading } from '@/results/useResultsReading';

export default function ResultsScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reading = useResultsReading(id);
  // A mark belongs to the one visit that follows Processing, even if it ends before the reading has loaded.
  useEffect(() => () => clearSymptomsAsked(id), [id]);
  if (reading === undefined) return <RouteShell title={t('results.title')} />;
  // An id with no stored reading shows no values rather than made-up ones.
  return reading ? (
    <ReadingResults key={reading.id} reading={reading} />
  ) : (
    <RouteShell title={t('results.title')} subtitle={t('result.inconclusive')} />
  );
}
