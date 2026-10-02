import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { SectionLabel } from '@/settings/SectionLabel';
import { Toggle } from '@/settings/Toggle';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const reminders = [
    { key: 'daily', title: t('notifications.daily') },
    { key: 'followUp', title: t('notifications.followUp'), subtitle: t('notifications.followUpHint') },
    { key: 'doctor', title: t('notifications.doctor'), subtitle: t('notifications.doctorHint') },
    { key: 'standing', title: t('notifications.standing') },
    { key: 'retest', title: t('notifications.retest') },
  ];
  return (
    <RouteShell title={t('notifications.title')}>
      <AppText tone="textDim">{t('notifications.notActive')}</AppText>
      <Card flush>
        {reminders.map(({ key, title, subtitle }, index) => (
          <ListRow
            key={key}
            title={title}
            subtitle={subtitle}
            last={index === reminders.length - 1}
            trailing={<Toggle label={title} value={false} disabled />}
          />
        ))}
      </Card>
      <SectionLabel>{t('notifications.quietHours')}</SectionLabel>
      <Card flush>
        <ListRow
          title={t('notifications.from')}
          trailing={<AppText tone="textDim">{t('notifications.quietStart')}</AppText>}
        />
        <ListRow
          title={t('notifications.until')}
          last
          trailing={<AppText tone="textDim">{t('notifications.quietEnd')}</AppText>}
        />
      </Card>
      <Card flush>
        <ListRow
          title={t('notifications.hideValues')}
          last
          trailing={<Toggle label={t('notifications.hideValues')} value={false} disabled />}
        />
      </Card>
      <AppText variant="caption" tone="textDim">
        {t('notifications.limit')}
      </AppText>
    </RouteShell>
  );
}
