import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { PreferenceSwitch } from '@/settings/PreferenceSwitch';
import { setPreference, usePreferences } from '@/settings/preferences';
import { SectionLabel } from '@/settings/SectionLabel';

type Reminder = {
  key: 'daily' | 'followUp' | 'doctor' | 'standing' | 'retest';
  title: string;
  subtitle?: string;
};

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const reminders: readonly Reminder[] = [
    { key: 'daily', title: t('notifications.daily'), subtitle: t('notifications.dailyTime') },
    { key: 'followUp', title: t('notifications.followUp'), subtitle: t('notifications.followUpHint') },
    { key: 'doctor', title: t('notifications.doctor'), subtitle: t('notifications.doctorHint') },
    { key: 'standing', title: t('notifications.standing') },
    { key: 'retest', title: t('notifications.retest') },
  ];
  return (
    <RouteShell title={t('notifications.title')}>
      <Card flush>
        {reminders.map(({ key, title, subtitle }, index) => (
          <ListRow
            key={key}
            title={title}
            subtitle={subtitle}
            last={index === reminders.length - 1}
            trailing={
              <PreferenceSwitch
                label={title}
                value={preferences[key]}
                onValueChange={(on) => setPreference(key, on)}
              />
            }
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
          trailing={
            <PreferenceSwitch
              label={t('notifications.hideValues')}
              value={preferences.hideWidgetValues}
              onValueChange={(on) => setPreference('hideWidgetValues', on)}
            />
          }
        />
      </Card>
      <AppText variant="caption" tone="textDim">
        {t('notifications.limit')}
      </AppText>
    </RouteShell>
  );
}
