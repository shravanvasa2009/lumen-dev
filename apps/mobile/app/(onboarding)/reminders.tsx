import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { NavButton } from '@/components/NavButton';
import { OnboardingStep } from '@/components/OnboardingStep';
import { ListRow } from '@/components/ListRow';
import { askPermission, saveAndSyncNotifications } from '@/notifications/applyPrefs';
import { loadNotificationPrefs } from '@/notifications/prefs';
import { Toggle } from '@/settings/Toggle';
import { useTheme } from '@/theme';

// Spec §8.2 step 9: the daily time starts at 8:00 am and the daily check starts off.
const DEFAULT_HOUR = 8;
const HOURS_PER_DAY = 24;

// Mockup 09 sets the chosen time well above the 34 pt display size.
const styles = StyleSheet.create({ selectedTime: { fontSize: 48, lineHeight: 56 } });

type Reminder = 'daily' | 'followUp' | 'doctor';

export default function RemindersScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const [hour, setHour] = useState(DEFAULT_HOUR);
  const [enabled, setEnabled] = useState<Record<Reminder, boolean>>({
    daily: false,
    followUp: true,
    doctor: true,
  });
  const timeOf = (hourOfDay: number, withPeriod = true) =>
    new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' })
      .formatToParts(new Date(2000, 0, 1, (hourOfDay + HOURS_PER_DAY) % HOURS_PER_DAY))
      .filter((part) => withPeriod || part.type !== 'dayPeriod')
      .map((part) => part.value)
      .join('')
      .trim();
  // Each time is formatted once: the screen shows neighbours without AM/PM, screen readers get it in full.
  const selected = timeOf(hour);
  const spokenBefore = timeOf(hour - 1);
  const spokenAfter = timeOf(hour + 1);
  const shownBefore = timeOf(hour - 1, false);
  const shownAfter = timeOf(hour + 1, false);
  const reminderRows: readonly { reminder: Reminder; title: string }[] = [
    { reminder: 'daily', title: t('notifications.daily') },
    { reminder: 'followUp', title: t('notifications.followUp') },
    { reminder: 'doctor', title: t('notifications.doctor') },
  ];

  // The app works without notifications, so a refusal or a failed request still moves on to Home.
  async function askPermissionThenOpenHome() {
    try {
      const permission = await askPermission();
      const saved = loadNotificationPrefs();
      await saveAndSyncNotifications(
        {
          ...saved,
          enabled: {
            ...saved.enabled,
            daily: true,
            confirmation: enabled.followUp,
            'doctor-followup': enabled.doctor,
          },
          dailyTime: { hour, minute: 0 },
        },
        i18n.language,
        permission,
      );
    } catch (error) {
      console.warn(
        `Notification permission request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    router.replace('/');
  }

  return (
    <OnboardingStep
      step={9}
      title={t('reminders.title')}
      subtitle={t('reminders.subtitle')}
      footer={
        <>
          <Button label={t('reminders.turnOn')} onPress={() => void askPermissionThenOpenHome()} />
          <NavButton label={t('reminders.notNow')} href="/" variant="link" replace />
        </>
      }
    >
      <Card>
        <View style={{ alignItems: 'center', gap: spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('reminders.earlier', { time: spokenBefore })}
            onPress={() => setHour((current) => (current + HOURS_PER_DAY - 1) % HOURS_PER_DAY)}
          >
            <AppText variant="title" tone="textDim">
              {shownBefore}
            </AppText>
          </Pressable>
          <AppText
            variant="display"
            style={styles.selectedTime}
            accessibilityLabel={t('reminders.timeSelected', { time: selected })}
          >
            {selected}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('reminders.later', { time: spokenAfter })}
            onPress={() => setHour((current) => (current + 1) % HOURS_PER_DAY)}
          >
            <AppText variant="title" tone="textDim">
              {shownAfter}
            </AppText>
          </Pressable>
        </View>
      </Card>
      <Card flush>
        {reminderRows.map(({ reminder, title }, index) => (
          <ListRow
            key={reminder}
            title={title}
            last={index === reminderRows.length - 1}
            trailing={
              <Toggle
                label={title}
                value={enabled[reminder]}
                onValueChange={(value) => setEnabled({ ...enabled, [reminder]: value })}
              />
            }
          />
        ))}
      </Card>
      <AppText variant="caption" tone="textDim">
        {t('reminders.localOnly')}
      </AppText>
    </OnboardingStep>
  );
}
