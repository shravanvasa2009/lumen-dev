import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';
import { evidenceFor } from '@/evidence';

export default function AccuracyScreen() {
  const { t } = useTranslation();
  const metrics = [
    { metric: 'hr', heading: t('accuracy.heartRate') },
    { metric: 'rhythm', heading: t('accuracy.rhythm') },
    { metric: 'hrv', heading: t('accuracy.hrv') },
    { metric: 'resp', heading: t('accuracy.breathing') },
    { metric: 'diabetes', heading: t('accuracy.diabetes') },
    { metric: 'extraBeats', heading: t('accuracy.extraBeats') },
  ] as const;
  return (
    <RouteShell
      title={t('accuracy.title')}
      subtitle={t('accuracy.subtitle')}
      sections={metrics.map(({ metric, heading }) => ({
        heading,
        metric,
        lines: evidenceFor(metric).measured ? [] : [t('evidence.notTested')],
      }))}
    >
      <AppText tone="textDim">{t('accuracy.falseAlarms')}</AppText>
      <AppText variant="caption" tone="textFaint">
        {t('prototype.banner')}
      </AppText>
    </RouteShell>
  );
}
