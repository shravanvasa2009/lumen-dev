import { PermissionStatus } from 'expo';
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications';

import type { NotificationPrefs, NotificationTriggers } from './plan';
import { saveNotificationPrefs } from './prefs';
import { syncNotifications } from './scheduler';

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

// The person's choices are always saved. Without permission nothing is scheduled, but the choices stay so
// they take effect when permission is granted.
export async function saveAndSyncNotifications(
  prefs: NotificationPrefs,
  languageTag: string,
  permission: Permission,
): Promise<void> {
  try {
    saveNotificationPrefs(prefs);
    await syncNotifications(
      {
        prefs: permission === 'granted' ? prefs : { ...prefs, enabled: NOTHING_ENABLED },
        triggers: NO_TRIGGERS,
        now: Date.now(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      languageTag,
    );
  } catch (error) {
    console.warn(`Reminders could not be updated: ${error instanceof Error ? error.message : String(error)}`);
  }
}
