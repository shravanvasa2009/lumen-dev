import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function ProcessingScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('processing.title')}
      subtitle={t('processing.subtitle')}
      sections={[
        {
          heading: t('processing.cleaned'),
          lines: [t('processing.rhythm'), t('processing.breathing'), t('processing.baseline')],
        },
      ]}
    >
      <AppText variant="caption" tone="textDim">
        {t('processing.onPhone')}
      </AppText>
      <NavButton label={t('processing.seeResults')} href="/results/demo" replace />
    </RouteShell>
  );
}
