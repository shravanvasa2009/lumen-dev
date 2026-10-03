import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { OnboardingStep } from '@/components/OnboardingStep';
import { ListRow } from '@/components/ListRow';
import { loadNotificationPrefs } from '@/notifications/prefs';
import { finishOnboarding } from '@/profile/onboarding';
import { askPermission, saveAndSyncNotifications } from '@/settings/applyPrefs';
import { formatClock } from '@/settings/formatClock';
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
  const [finishFailed, setFinishFailed] = useState(false);
  const [hour, setHour] = useState(DEFAULT_HOUR);
  const [enabled, setEnabled] = useState<Record<Reminder, boolean>>({
    daily: false,
    followUp: true,
    doctor: true,
  });
  const timeOf = (hourOfDay: number, withPeriod = true) =>
    formatClock({ hour: (hourOfDay + HOURS_PER_DAY) % HOURS_PER_DAY, minute: 0 }, i18n.language, withPeriod);
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

  // Home is the first screen on every later launch only once this is saved, so a failed save keeps the
  // person here with a message instead of showing Welcome again next time without a word.
  async function openHome() {
    try {
      await finishOnboarding();
    } catch {
      setFinishFailed(true);
      return;
    }
    router.replace('/');
  }

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
            daily: enabled.daily,
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
    await openHome();
  }

  return (
    <OnboardingStep
      step={9}
      title={t('reminders.title')}
      subtitle={t('reminders.subtitle')}
      footer={
        <>
          <Button label={t('reminders.turnOn')} onPress={() => void askPermissionThenOpenHome()} />
          <Button label={t('reminders.notNow')} variant="link" onPress={() => void openHome()} />
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
      {finishFailed ? (
        <AppText variant="caption" tone="textDim" accessibilityRole="alert">
          {t('reminders.finishFailed')}
        </AppText>
      ) : null}
    </OnboardingStep>
  );
}
