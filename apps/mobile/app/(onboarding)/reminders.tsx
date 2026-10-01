import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { NavButton } from '@/components/NavButton';
import { RouteShell } from '@/components/RouteShell';

export default function RemindersScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('reminders.title')}
      subtitle={t('reminders.subtitle')}
      sections={[
        { heading: t('notifications.daily') },
        { heading: t('notifications.followUp') },
        { heading: t('notifications.doctor') },
      ]}
    >
      <AppText variant="caption" tone="textDim">
        {t('reminders.localOnly')}
      </AppText>
      <NavButton label={t('reminders.turnOn')} href="/" replace />
      <NavButton label={t('reminders.notNow')} href="/" variant="secondary" replace />
    </RouteShell>
  );
}
