import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { useResultsReading } from '@/results/useResultsReading';
import { WhyReading } from '@/results/WhyReading';

export default function WhyScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reading = useResultsReading(id);
  if (reading === undefined) return <RouteShell title={t('results.title')} />;
  return reading ? <WhyReading reading={reading} /> : <RouteShell title={t('result.inconclusive')} />;
}
