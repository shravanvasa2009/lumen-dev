import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { readingById } from '@/results/fixtures';
import { WhyReading } from '@/results/WhyReading';

export default function WhyScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reading = readingById(id);
  return reading ? <WhyReading reading={reading} /> : <RouteShell title={t('result.inconclusive')} />;
}
