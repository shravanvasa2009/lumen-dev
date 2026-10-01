import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';

export default function ModeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const modes: readonly { title: string; subtitle: string; href: Href }[] = [
    { title: t('mode.full'), subtitle: t('mode.fullBody'), href: '/measure/precheck?mode=full' },
    { title: t('mode.quick'), subtitle: t('mode.quickBody'), href: '/measure/precheck?mode=quick' },
    { title: t('mode.standing'), subtitle: t('mode.standingBody'), href: '/measure/standing-test' },
  ];
  return (
    <RouteShell title={t('mode.title')}>
      {modes.map((mode) => (
        <ListRow
          key={mode.title}
          title={mode.title}
          subtitle={mode.subtitle}
          onPress={() => router.push(mode.href)}
        />
      ))}
    </RouteShell>
  );
}
