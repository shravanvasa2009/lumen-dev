import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import type { NotificationType } from '@/notifications/plan';
import { loadNotificationPrefs } from '@/notifications/prefs';
import {
  askPermission,
  currentPermission,
  type Permission,
  saveAndSyncNotifications,
} from '@/settings/applyPrefs';
import { formatClock } from '@/settings/formatClock';
import { SectionLabel } from '@/settings/SectionLabel';
import { Toggle } from '@/settings/Toggle';
import { setPreference, usePreferences } from '@/theme/preferences';

export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const { hideWidgetValues } = usePreferences();
  const [prefs, setPrefs] = useState(loadNotificationPrefs);
  const [permission, setPermission] = useState<Permission | null>(null);
  const [failed, setFailed] = useState(false);
  const latestPrefs = useRef(prefs);
  const knownPermission = useRef<Permission | null>(null);

  // Coming back from the phone's settings is the only way the answer changes, so it is read on every focus.
  useFocusEffect(
    useCallback(() => {
      let stale = false;
      currentPermission().then(
        (now) => {
          if (stale) return;
          const changedWhileAway = knownPermission.current !== null && knownPermission.current !== now;
          knownPermission.current = now;
          setPermission(now);
          if (changedWhileAway)
            saveAndSyncNotifications(latestPrefs.current, i18n.language, now).catch(() => setFailed(true));
        },
        () => {
          if (!stale) setFailed(true);
        },
      );
      return () => {
        stale = true;
      };
    }, [i18n.language]),
  );

  async function setReminder(type: NotificationType, on: boolean) {
    const previous = latestPrefs.current;
    const next = { ...previous, enabled: { ...previous.enabled, [type]: on } };
    latestPrefs.current = next;
    setPrefs(next);
    setFailed(false);
    try {
      let answer = permission ?? (await currentPermission());
      if (on && answer === 'undetermined') answer = await askPermission();
      knownPermission.current = answer;
      setPermission(answer);
      await saveAndSyncNotifications(next, i18n.language, answer);
    } catch {
      latestPrefs.current = previous;
      setPrefs(previous);
      setFailed(true);
    }
  }

  const reminders: readonly { type: NotificationType; title: string; subtitle?: string }[] = [
    { type: 'daily', title: t('notifications.daily') },
    { type: 'confirmation', title: t('notifications.followUp'), subtitle: t('notifications.followUpHint') },
    { type: 'doctor-followup', title: t('notifications.doctor'), subtitle: t('notifications.doctorHint') },
    { type: 'standing', title: t('notifications.standing') },
    { type: 'retest', title: t('notifications.retest') },
  ];
  const denied = permission === 'denied';
  return (
    <RouteShell title={t('notifications.title')}>
      {denied ? (
        <Card>
          <AppText>{t('notifications.denied')}</AppText>
          <Button
            variant="secondary"
            label={t('notifications.openSettings')}
            onPress={() => void Linking.openSettings()}
          />
        </Card>
      ) : null}
      {failed ? <AppText tone="textDim">{t('notifications.updateFailed')}</AppText> : null}
      <Card flush>
        {reminders.map(({ type, title, subtitle }, index) => (
          <ListRow
            key={type}
            title={title}
            subtitle={subtitle}
            last={index === reminders.length - 1}
            trailing={
              <Toggle
                label={title}
                value={prefs.enabled[type] && !denied}
                disabled={denied}
                onValueChange={(on) => void setReminder(type, on)}
              />
            }
          />
        ))}
      </Card>
      <SectionLabel>{t('notifications.quietHours')}</SectionLabel>
      <Card flush>
        <ListRow
          title={t('notifications.from')}
          trailing={<AppText tone="textDim">{formatClock(prefs.quietHours.start, i18n.language)}</AppText>}
        />
        <ListRow
          title={t('notifications.until')}
          last
          trailing={<AppText tone="textDim">{formatClock(prefs.quietHours.end, i18n.language)}</AppText>}
        />
      </Card>
      <Card flush>
        <ListRow
          title={t('notifications.hideValues')}
          last
          trailing={
            <Toggle
              label={t('notifications.hideValues')}
              value={hideWidgetValues}
              onValueChange={(hidden) => setPreference('hideWidgetValues', hidden)}
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
