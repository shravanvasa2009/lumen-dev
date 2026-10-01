import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function StandingTestScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('standing.title')}
      sections={[
        { heading: t('standing.lying') },
        { heading: t('standing.now') },
        { heading: t('standing.rise') },
      ]}
    >
      <AppText tone="textDim">{t('standing.interval')}</AppText>
      <AppText>{t('standing.safety')}</AppText>
      <NavButton label={t('standing.stop')} href="/" variant="secondary" replace />
    </RouteShell>
  );
}
