import { PermissionStatus } from 'expo';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications';
import i18next from 'i18next';

import type { NotificationPrefs } from '@/notifications/plan';
import { loadNotificationPrefs, saveNotificationPrefs } from '@/notifications/prefs';
import { syncNotifications } from '@/notifications/scheduler';
import { storedTriggers } from '@/notifications/storedTriggers';

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

const NOTHING_ENABLED: NotificationPrefs['enabled'] = {
  daily: false,
  confirmation: false,
  'doctor-followup': false,
  standing: false,
  retest: false,
};

async function syncStored(prefs: NotificationPrefs, languageTag: string, permission: Permission) {
  await syncNotifications(
    {
      prefs: permission === 'granted' ? prefs : { ...prefs, enabled: NOTHING_ENABLED },
      triggers: await storedTriggers(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    languageTag,
  );
}

// Scheduling comes first: if it fails nothing is saved, so the screen can show the previous choice again
// and the saved file still matches it. Without permission nothing is scheduled, but the choices are kept so
// they take effect when permission is granted. Failures reach the caller.
export async function saveAndSyncNotifications(
  prefs: NotificationPrefs,
  languageTag: string,
  permission: Permission,
): Promise<void> {
  await syncStored(prefs, languageTag, permission);
  saveNotificationPrefs(prefs);
}

// For a saved reading, follow-up answer, phone rating, or language change: the saved choices are
// unchanged, but the reminders move or need new text. A failure is reported and the app stays usable; the
// next sync repairs the schedule. Resolves false on failure so a screen can say so.
export async function resyncNotifications(languageTag: string = i18next.language): Promise<boolean> {
  try {
    await syncStored(loadNotificationPrefs(), languageTag, await currentPermission());
    return true;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Reminders could not be updated: ${reason}`);
    return false;
  }
}
