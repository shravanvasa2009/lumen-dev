import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function ResultsScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RouteShell
      title={t('results.title')}
      sections={[
        { heading: t('results.heartRhythm') },
        { heading: t('results.heartRate') },
        { heading: t('results.hrv') },
        { heading: t('results.experimental') },
      ]}
    >
      <AppText tone="textDim">{t('result.notChecked')}</AppText>
      <NavButton label={t('results.accuracy')} href="/settings/accuracy" variant="secondary" />
      <NavButton label={t('results.showWhy')} href={`/results/${id}/why`} variant="secondary" />
      <NavButton label={t('results.share')} href={`/report/${id}`} />
      {/* Shown for every result until the core contract lands; it will then appear only for a flagged one. */}
      <AppText variant="headline">{t('safety.title')}</AppText>
      <AppText>{t('safety.question')}</AppText>
      <NavButton label={t('safety.yes')} href="/emergency" variant="secondary" />
      <NavButton label={t('safety.no')} href="/" variant="secondary" replace />
      <AppText variant="caption" tone="textDim">
        {t('safety.yesOpens')}
      </AppText>
    </RouteShell>
  );
}
