import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('tabs.home')}
      subtitle={t('app.tagline')}
      sections={[
        { heading: t('home.restingHr') },
        { heading: t('home.hrv') },
        { heading: t('home.breathing') },
      ]}
    >
      <NavButton label={t('home.measure')} href="/measure/mode" />
      <NavButton label={t('home.changeMode')} href="/measure/mode" variant="secondary" />
      <NavButton label={t('home.latestResult')} href="/results/demo" variant="secondary" />
      <NavButton label={t('home.followUp')} href="/follow-up" variant="secondary" />
    </RouteShell>
  );
}
