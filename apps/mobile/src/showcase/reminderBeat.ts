import {
  AndroidImportance,
  cancelScheduledNotificationAsync,
  getAllScheduledNotificationsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
} from 'expo-notifications';

import { ID_PREFIXES } from '@/notifications/plan';

const FILM_CHANNEL = 'showcase-reminders';

// The daily reminder set during setup is due at this minute. Android may hold an exact-time alarm back by
// seconds to minutes, so the film delivers that same scheduled reminder (same words, same tap route) at the
// beat itself and cancels the late copy.
// https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
export async function deliverDailyReminderNow(): Promise<boolean> {
  const scheduled = await getAllScheduledNotificationsAsync();
  // Ids end in the ISO fire time, so the first in sort order is the next one due.
  const daily = scheduled
    .filter(({ identifier }) => identifier.startsWith(`${ID_PREFIXES.daily}-`))
    .sort((a, b) => a.identifier.localeCompare(b.identifier))[0];
  if (daily === undefined) {
    console.warn('[showcase] no daily reminder is scheduled; was Daily check turned on in setup?');
    return false;
  }
  await cancelScheduledNotificationAsync(daily.identifier);
  // The reminders channel is default importance, which Android lists in the shade but never pops up over the
  // app; the film needs it seen arriving, so a silent high-importance channel carries it.
  await setNotificationChannelAsync(FILM_CHANNEL, {
    name: 'Lumen reminders',
    importance: AndroidImportance.HIGH,
    sound: null,
    enableVibrate: false,
  });
  await scheduleNotificationAsync({
    identifier: daily.identifier,
    // eslint-disable-next-line id-denylist -- the field name belongs to expo-notifications' content type.
    content: { body: daily.content.body ?? undefined, data: daily.content.data },
    trigger: { channelId: FILM_CHANNEL },
  });
  return true;
}
