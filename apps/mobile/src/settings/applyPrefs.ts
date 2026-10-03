import { PermissionStatus } from 'expo';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications';

import type { NotificationPrefs, NotificationTriggers } from '@/notifications/plan';
import { loadNotificationPrefs, saveNotificationPrefs } from '@/notifications/prefs';
import { syncNotifications } from '@/notifications/scheduler';

// expo-notifications 57: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#getpermissionsasync
export type Permission = 'granted' | 'denied' | 'undetermined';

const permissionOf = ({ status, granted }: { status: PermissionStatus; granted: boolean }): Permission =>
  granted ? 'granted' : status === PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';

export async function currentPermission(): Promise<Permission> {
  return permissionOf(await getPermissionsAsync());
}

export async function askPermission(): Promise<Permission> {
  return permissionOf(await requestPermissionsAsync());
}

// Nothing the triggers need is stored yet (no readings store, no standing-test state, no phone-check
// date), so reminders that follow a result stay unscheduled until those exist.
const NO_TRIGGERS: NotificationTriggers = {
  confirmationFor: null,
  doctorFollowupFor: null,
  standingStartedAt: null,
  lastPhoneCheckAt: null,
};

const NOTHING_ENABLED: NotificationPrefs['enabled'] = {
  daily: false,
  confirmation: false,
  'doctor-followup': false,
  standing: false,
  retest: false,
};

// Scheduling comes first: if it fails nothing is saved, so the screen can show the previous choice again
// and the saved file still matches it. Without permission nothing is scheduled, but the choices are kept so
// they take effect when permission is granted. Failures reach the caller.
async function syncFor(prefs: NotificationPrefs, languageTag: string, permission: Permission): Promise<void> {
  await syncNotifications(
    {
      prefs: permission === 'granted' ? prefs : { ...prefs, enabled: NOTHING_ENABLED },
      triggers: NO_TRIGGERS,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    languageTag,
  );
}

export async function saveAndSyncNotifications(
  prefs: NotificationPrefs,
  languageTag: string,
  permission: Permission,
): Promise<void> {
  await syncFor(prefs, languageTag, permission);
  saveNotificationPrefs(prefs);
}

// A reminder's text is fixed when it is scheduled, so a language change plans the saved choices again.
export async function resyncNotifications(languageTag: string): Promise<void> {
  await syncFor(loadNotificationPrefs(), languageTag, await currentPermission());
}
