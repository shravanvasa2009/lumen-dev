import { useTranslation } from 'react-i18next';

import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function RatingScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('rating.title')}
      subtitle={t('rating.subtitle')}
      sections={[{ heading: t('rating.unlocked') }]}
    >
      <NavButton label={t('common.continue')} href="/reminders" />
    </RouteShell>
  );
}
