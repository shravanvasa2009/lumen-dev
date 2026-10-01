import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function PracticeScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('practice.title')}
      subtitle={t('practice.subtitle')}
      sections={[
        { heading: t('signal.weak') },
        { heading: t('signal.ok') },
        { heading: t('signal.strong') },
        { heading: t('practice.steady') },
      ]}
    >
      <NavButton label={t('common.continue')} href="/how-to-sit" />
    </RouteShell>
  );
}
