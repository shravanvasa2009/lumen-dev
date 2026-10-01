import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function ProfileScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      headerless
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      sections={[
        { heading: t('profile.basics') },
        { heading: t('profile.healthNotes'), lines: [t('profile.note')] },
      ]}
    >
      <NavButton label={t('common.continue')} href="/phone-check" />
    </RouteShell>
  );
}
