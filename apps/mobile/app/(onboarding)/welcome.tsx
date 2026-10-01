import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell title={t('app.name')} subtitle={t('app.tagline')}>
      <NavButton label={t('welcome.getStarted')} href="/consent" />
      <NavButton label={t('welcome.tryDemo')} href="/" variant="secondary" replace />
      <AppText variant="caption" tone="textFaint">
        {t('welcome.footer')}
      </AppText>
    </RouteShell>
  );
}
