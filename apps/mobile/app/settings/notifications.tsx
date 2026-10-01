import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { RouteShell } from '@/components/RouteShell';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  return (
    <RouteShell
      title={t('notifications.title')}
      sections={[
        {
          heading: t('notifications.daily'),
          lines: [
            t('notifications.followUp'),
            t('notifications.doctor'),
            t('notifications.standing'),
            t('notifications.retest'),
          ],
        },
        {
          heading: t('notifications.quietHours'),
          lines: [t('notifications.from'), t('notifications.until')],
        },
        { heading: t('notifications.hideValues') },
      ]}
    >
      <AppText variant="caption" tone="textDim">
        {t('notifications.limit')}
      </AppText>
    </RouteShell>
  );
}
