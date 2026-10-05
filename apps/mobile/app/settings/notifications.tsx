import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ListRow } from '@/components/ListRow';
import { RouteShell } from '@/components/RouteShell';
import type { ClockTime } from '@/notifications/localTime';
import type { NotificationPrefs, NotificationType } from '@/notifications/plan';
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

type TimeRowProps = {
  title: string;
  time: ClockTime;
  languageTag: string;
  last?: boolean;
  onChange: (time: ClockTime) => void;
};

// The dial follows the clock the rows are written in: en shows "7:00 AM", es "7:00". Android takes is24Hour;
// iOS follows the locale, so both are passed.
const usesDayPeriod = (languageTag: string) =>
  new Intl.DateTimeFormat(languageTag, { hour: 'numeric' })
    .formatToParts(new Date(2000, 0, 1, 7))
    .some((part) => part.type === 'dayPeriod');

// Android shows the picker as a dialog while it is mounted; iOS shows it inline under the row until the row is
// tapped again. The date part is arbitrary: only the hour and minute are kept.
function TimeRow({ title, time, languageTag, last = false, onChange }: TimeRowProps) {
  const [open, setOpen] = useState(false);
  const pick = (picked: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    onChange({ hour: picked.getHours(), minute: picked.getMinutes() });
  };
  return (
    <>
      <ListRow
        title={title}
        last={last && !open}
        expanded={open}
        onPress={() => setOpen((shown) => !shown)}
        trailing={<AppText tone="textDim">{formatClock(time, languageTag)}</AppText>}
      />
      {open ? (
        <DateTimePicker
          mode="time"
          value={new Date(2000, 0, 1, time.hour, time.minute)}
          onValueChange={(_event, picked) => pick(picked)}
          onDismiss={() => setOpen(false)}
          is24Hour={!usesDayPeriod(languageTag)}
          locale={languageTag}
        />
      ) : null}
    </>
  );
}

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

  async function savePrefs(change: (previous: NotificationPrefs) => NotificationPrefs, asking: boolean) {
    const previous = latestPrefs.current;
    const next = change(previous);
    latestPrefs.current = next;
    setPrefs(next);
    setFailed(false);
    try {
      let answer = permission ?? (await currentPermission());
      if (asking && answer === 'undetermined') answer = await askPermission();
      knownPermission.current = answer;
      setPermission(answer);
      await saveAndSyncNotifications(next, i18n.language, answer);
    } catch {
      latestPrefs.current = previous;
      setPrefs(previous);
      setFailed(true);
    }
  }

  const setReminder = (type: NotificationType, on: boolean) =>
    savePrefs((previous) => ({ ...previous, enabled: { ...previous.enabled, [type]: on } }), on);
  const setDailyTime = (dailyTime: ClockTime) => savePrefs((previous) => ({ ...previous, dailyTime }), false);
  const setQuietHours = (edge: 'start' | 'end', time: ClockTime) =>
    savePrefs((previous) => ({ ...previous, quietHours: { ...previous.quietHours, [edge]: time } }), false);

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
          <Fragment key={type}>
            <ListRow
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
            {type === 'daily' && prefs.enabled.daily && !denied ? (
              <TimeRow
                title={t('notifications.dailyTime')}
                time={prefs.dailyTime}
                languageTag={i18n.language}
                onChange={(time) => void setDailyTime(time)}
              />
            ) : null}
          </Fragment>
        ))}
      </Card>
      <SectionLabel>{t('notifications.quietHours')}</SectionLabel>
      <Card flush>
        <TimeRow
          title={t('notifications.from')}
          time={prefs.quietHours.start}
          languageTag={i18n.language}
          onChange={(time) => void setQuietHours('start', time)}
        />
        <TimeRow
          title={t('notifications.until')}
          time={prefs.quietHours.end}
          languageTag={i18n.language}
          last
          onChange={(time) => void setQuietHours('end', time)}
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
