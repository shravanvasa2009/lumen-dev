import {
  AndroidImportance,
  cancelScheduledNotificationAsync,
  getAllScheduledNotificationsAsync,
  SchedulableTriggerInputTypes,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
} from 'expo-notifications';

import { lockscreenStrings } from '../i18n/lockscreen';
import { ID_PREFIXES, type NotificationType, planNotifications, type PlanRequest } from './plan';

// expo-notifications 57: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/

type CopyKey = 'notif.daily' | 'notif.confirm' | 'notif.followup' | 'notif.standing' | 'notif.retest';

// WID-2: every word a notification shows comes from lockscreen.json, which the copy check scans.
const COPY_KEYS: Readonly<Record<NotificationType, CopyKey>> = {
  daily: 'notif.daily',
  confirmation: 'notif.confirm',
  'doctor-followup': 'notif.followup',
  standing: 'notif.standing',
  retest: 'notif.retest',
};

const REMINDERS_CHANNEL = 'reminders';
const STANDING_CHANNEL = 'standing';

const isLumenRequest = (identifier: string) =>
  Object.values(ID_PREFIXES).some((prefix) => identifier.startsWith(`${prefix}-`));

async function applyPlan(request: PlanRequest, languageTag: string): Promise<void> {
  const copy = lockscreenStrings(languageTag);
  // Android 8+ needs a channel per kind of alert; the standing test's is high importance because a reading
  // is due within seconds. iOS has no channels and these calls resolve to null there.
  await setNotificationChannelAsync(REMINDERS_CHANNEL, {
    name: copy['channel.reminders'],
    importance: AndroidImportance.DEFAULT,
  });
  await setNotificationChannelAsync(STANDING_CHANNEL, {
    name: copy['channel.standing'],
    importance: AndroidImportance.HIGH,
  });

  // Every earlier Lumen request is cancelled, not only the stale ones, so the ones that stay are scheduled
  // again with the current language and route.
  const scheduled = await getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .map(({ identifier }) => identifier)
      .filter(isLumenRequest)
      .map((identifier) => cancelScheduledNotificationAsync(identifier)),
  );

  for (const entry of planNotifications(request))
    await scheduleNotificationAsync({
      identifier: entry.id,
      // eslint-disable-next-line id-denylist -- the field name belongs to expo-notifications' content type.
      content: { body: copy[COPY_KEYS[entry.type]], data: { url: entry.route } },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: Date.parse(entry.fireAt),
        channelId: entry.type === 'standing' ? STANDING_CHANNEL : REMINDERS_CHANNEL,
      },
    });
}

let lastSync: Promise<void> = Promise.resolve();

// Runs one sync at a time, so two quick settings changes cannot interleave their cancels and schedules.
// The caller still receives each sync's own failure; the queue only waits for it to settle.
export function syncNotifications(request: PlanRequest, languageTag: string): Promise<void> {
  const sync = lastSync.then(() => applyPlan(request, languageTag));
  lastSync = sync.catch(() => undefined);
  return sync;
}
