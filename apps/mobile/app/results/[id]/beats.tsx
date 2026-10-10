import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RouteShell } from '@/components/RouteShell';
import { BeatByBeatView } from '@/results/BeatByBeatView';
import { useResultsReading } from '@/results/useResultsReading';

export default function BeatsScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reading = useResultsReading(id);
  if (!reading) return <RouteShell title={t('results.title')} />;
  return <BeatByBeatView reading={reading} />;
}
