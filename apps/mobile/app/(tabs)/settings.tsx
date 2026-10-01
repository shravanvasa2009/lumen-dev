import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const rows: readonly { title: string; href: Href }[] = [
    { title: t('settings.profile'), href: '/profile' },
    { title: t('notifications.title'), href: '/settings/notifications' },
    { title: t('appearance.title'), href: '/settings/appearance' },
    { title: t('settings.accuracy'), href: '/settings/accuracy' },
    { title: t('settings.phone'), href: '/settings/phone' },
    { title: t('settings.widgets'), href: '/settings/widgets' },
    { title: t('settings.followUp'), href: '/follow-up' },
    { title: t('settings.lab'), href: '/settings/lab' },
  ];
  return (
    <RouteShell title={t('settings.title')}>
      {rows.map((row) => (
        <ListRow key={row.title} title={row.title} onPress={() => router.push(row.href)} />
      ))}
    </RouteShell>
  );
}
