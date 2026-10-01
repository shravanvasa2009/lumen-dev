import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';

export default function AccuracyScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('accuracy.title')}
      subtitle={t('accuracy.subtitle')}
      sections={[
        { heading: t('accuracy.heartRate') },
        { heading: t('accuracy.rhythm') },
        { heading: t('accuracy.hrv') },
        { heading: t('accuracy.breathing') },
        { heading: t('accuracy.diabetes') },
        { heading: t('accuracy.extraBeats') },
      ]}
    >
      <AppText tone="textDim">{t('accuracy.falseAlarms')}</AppText>
      <AppText variant="caption" tone="textFaint">
        {t('prototype.banner')}
      </AppText>
    </RouteShell>
  );
}
