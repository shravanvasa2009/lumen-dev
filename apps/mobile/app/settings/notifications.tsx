import { useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListRow } from '@/components/ListRow';
import type { IconName } from '@/components/Icon';
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
import { DayDial } from '@/settings/DayDial';
import { formatClock } from '@/settings/formatClock';
import { GroupLabel } from '@/settings/GroupLabel';
import { IconTile } from '@/settings/IconTile';
import { TimeRow } from '@/settings/TimeRow';
import { Toggle } from '@/settings/Toggle';
import { useTheme } from '@/theme';
import { setPreference, usePreferences } from '@/theme/preferences';

function DialLegend({ dot, title, detail }: { dot: string; title: string; detail: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: dot }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="subheadline" style={{ fontWeight: '600' }}>
          {title}
        </AppText>
        <AppText variant="caption" tone="textDim">
          {detail}
        </AppText>
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const { hideWidgetValues } = usePreferences();
  const { colors, spacing } = useTheme();
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

  const reminders: readonly { type: NotificationType; icon: IconName; title: string; subtitle?: string }[] = [
    { type: 'daily', icon: 'clock', title: t('notifications.daily') },
    {
      type: 'confirmation',
      icon: 'check',
      title: t('notifications.followUp'),
      subtitle: t('notifications.followUpHint'),
    },
    {
      type: 'doctor-followup',
      icon: 'care',
      title: t('notifications.doctor'),
      subtitle: t('notifications.doctorHint'),
    },
    { type: 'standing', icon: 'standing', title: t('notifications.standing') },
    { type: 'retest', icon: 'phone', title: t('notifications.retest') },
  ];
  const denied = permission === 'denied';
  const dailyOn = prefs.enabled.daily && !denied;
  const clock = (time: ClockTime) => formatClock(time, i18n.language);
  const quietRange = t('notifications.quietRange', {
    from: clock(prefs.quietHours.start),
    until: clock(prefs.quietHours.end),
  });
  const dailyClock = clock(prefs.dailyTime);
  const dailyWithoutPeriod = formatClock(prefs.dailyTime, i18n.language, false);
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
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <DayDial
            quietStart={prefs.quietHours.start}
            quietEnd={prefs.quietHours.end}
            dailyTime={dailyOn ? prefs.dailyTime : null}
            centerMain={dailyOn ? dailyWithoutPeriod : t('notifications.dialOff')}
            centerSub={
              dailyOn ? dailyClock.replace(dailyWithoutPeriod, '').trim() : t('notifications.dialOffSub')
            }
            accessibilityLabel={
              dailyOn
                ? t('notifications.dialLabelOn', { time: dailyClock, range: quietRange })
                : t('notifications.dialLabelOff', { range: quietRange })
            }
          />
          <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
            <DialLegend
              dot={colors.buttonFill}
              title={t('notifications.daily')}
              detail={dailyOn ? dailyClock : t('notifications.dialOff')}
            />
            <DialLegend dot={colors.textDim} title={t('notifications.quietHours')} detail={quietRange} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="clock" size={14} color={colors.textDim} />
              <AppText variant="caption" tone="textDim" style={{ flex: 1 }}>
                {t('notifications.limitShort')}
              </AppText>
            </View>
          </View>
        </View>
      </Card>
      <Card flush>
        {reminders.map(({ type, icon, title, subtitle }, index) => (
          <Fragment key={type}>
            <ListRow
              title={title}
              leading={<IconTile name={icon} />}
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
            {type === 'daily' && dailyOn ? (
              <TimeRow
                leading={<IconTile name="clock" />}
                title={t('notifications.dailyTime')}
                time={prefs.dailyTime}
                languageTag={i18n.language}
                onChange={(time) => void setDailyTime(time)}
              />
            ) : null}
          </Fragment>
        ))}
      </Card>
      <GroupLabel>{t('notifications.quietHours')}</GroupLabel>
      <Card flush>
        <TimeRow
          leading={<IconTile name="clock" neutral />}
          title={t('notifications.from')}
          time={prefs.quietHours.start}
          languageTag={i18n.language}
          onChange={(time) => void setQuietHours('start', time)}
        />
        <TimeRow
          leading={<IconTile name="clock" neutral />}
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
          leading={<IconTile name="lock" />}
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
