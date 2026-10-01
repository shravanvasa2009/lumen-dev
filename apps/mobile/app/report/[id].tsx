import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';

export default function ReportScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('report.title')}
      subtitle={t('prototype.banner')}
      sections={[
        { heading: t('report.heading') },
        { heading: t('report.pulseStrip') },
        { heading: t('report.evidence') },
      ]}
    >
      <AppText variant="caption" tone="textDim">
        {t('report.sharedOnly')}
      </AppText>
    </RouteShell>
  );
}
