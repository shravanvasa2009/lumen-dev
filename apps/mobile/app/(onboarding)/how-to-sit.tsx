import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function HowToSitScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('howToSit.title')}
      subtitle={t('howToSit.subtitle')}
      sections={[
        { heading: t('howToSit.elbows') },
        { heading: t('howToSit.height') },
        { heading: t('howToSit.hand') },
        { heading: t('howToSit.warm') },
      ]}
    >
      <NavButton label={t('common.continue')} href="/rating" />
    </RouteShell>
  );
}
