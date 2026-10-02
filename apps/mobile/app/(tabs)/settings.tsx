import Constants from 'expo-constants';
import { type Href, useRouter } from 'expo-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import { Toggle } from '@/settings/Toggle';
import { usePreferences } from '@/theme/preferences';

// Seven quick taps open Lab mode; a pause longer than this starts the count over.
const LAB_TAPS = 7;
const LAB_TAP_WINDOW_MS = 2000;

type SettingsRow = { title: string; value?: string; href?: Href };

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { appearance } = usePreferences();
  const versionTaps = useRef({ count: 0, at: 0 });

  const appearanceNames = {
    system: t('appearance.segmentSystem'),
    light: t('appearance.light'),
    dark: t('appearance.dark'),
  };
  const accountRows: readonly SettingsRow[] = [
    { title: t('settings.profile'), href: '/profile' },
    {
      title: t('notifications.title'),
      value: t('settings.notActiveYet'),
      href: '/settings/notifications',
    },
    { title: t('appearance.title'), value: appearanceNames[appearance], href: '/settings/appearance' },
    { title: t('settings.language') },
  ];
  const accuracyRows: readonly SettingsRow[] = [
    { title: t('settings.accuracy'), href: '/settings/accuracy' },
  ];
  const phoneRows: readonly SettingsRow[] = [
    { title: t('settings.phone'), value: t('settings.phoneNotTested'), href: '/settings/phone' },
    { title: t('settings.widgets'), href: '/settings/widgets' },
    { title: t('settings.replayTutorial'), href: '/welcome' },
    { title: t('settings.demoMode') },
  ];
  const dataRows: readonly SettingsRow[] = [
    { title: t('settings.export') },
    { title: t('settings.delete') },
    { title: t('settings.about') },
  ];

  function countVersionTap() {
    const now = Date.now();
    const inStreak = now - versionTaps.current.at <= LAB_TAP_WINDOW_MS;
    const count = inStreak ? versionTaps.current.count + 1 : 1;
    versionTaps.current = { count: count === LAB_TAPS ? 0 : count, at: now };
    if (count === LAB_TAPS) router.push('/settings/lab');
  }

  // A row with no destination is a feature that does not exist yet, so it shows "Coming soon" and does nothing.
  function renderRows(rows: readonly SettingsRow[]) {
    return rows.map(({ title, value, href }, index) => {
      const shownValue = value ?? (href === undefined ? t('settings.comingSoon') : undefined);
      return (
        <ListRow
          key={title}
          title={title}
          last={index === rows.length - 1}
          chevron={href !== undefined}
          trailing={shownValue ? <AppText tone="textDim">{shownValue}</AppText> : undefined}
          onPress={href === undefined ? undefined : () => router.push(href)}
        />
      );
    });
  }

  return (
    <RouteShell tabRoot title={t('settings.title')}>
      <Card flush>{renderRows(accountRows)}</Card>
      <Card flush>
        <ListRow
          title={t('settings.healthSync')}
          trailing={<Toggle label={t('settings.healthSync')} value={false} disabled />}
        />
        {renderRows(accuracyRows)}
      </Card>
      <Card flush>{renderRows(phoneRows)}</Card>
      <Card flush>{renderRows(dataRows)}</Card>
      <Pressable accessibilityRole="button" onPress={countVersionTap}>
        <AppText variant="caption" tone="textFaint" style={{ textAlign: 'center' }}>
          {t('settings.version', { version: Constants.expoConfig?.version ?? '' })}
        </AppText>
      </Pressable>
    </RouteShell>
  );
}
